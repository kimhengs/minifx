import { addMedia, updateMedia } from "../commands";
import { createProject, type CompSettings } from "../engine/factory";
import { uid } from "../engine/interpolation";
import { migrateProject, serializeProject } from "../engine/migrations";
import type { MediaItem } from "../engine/types";
import { useProject } from "../store/projectStore";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { backend, baseName, isDesktop, kindFromName, type PickedFile } from "./backend";

const SESSION = "session.json";
const AUTOSAVE = "autosave.msproj";

interface Session {
  cleanExit: boolean;
  filePath: string | null;
  projectName: string;
  savedAt: string;
}

export function newProject(comp?: Partial<CompSettings>): void {
  useProject.getState().load(createProject("Untitled Project", comp), null);
  useUi.getState().set({ startScreen: false });
}

export async function openProject(path?: string): Promise<boolean> {
  const ui = useUi.getState();
  try {
    const p = path ?? (await backend.openProjectDialog());
    if (!p) return false;
    const text = await backend.readTextFile(p);
    const project = migrateProject(JSON.parse(text));
    useProject.getState().load(project, isDesktop() ? p : null);
    if (isDesktop()) useSettings.getState().addRecent(p);
    ui.set({ startScreen: false });
    ui.toast(`Opened ${baseName(p)}`, "success");
    void refreshMediaStatus();
    return true;
  } catch (e) {
    ui.toast(`Could not open project: ${String(e instanceof Error ? e.message : e)}`, "error");
    void backend.log(`open failed: ${String(e)}`);
    return false;
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const s = useProject.getState();
  let path = s.filePath;
  if (!path || saveAs) {
    path = await backend.saveProjectDialog(s.project.name.replace(/[^\w\- ]+/g, "") || "Untitled");
    if (!path) return false;
  }
  try {
    const name = baseName(path).replace(/\.msproj$/i, "");
    const project = { ...s.project, name };
    await backend.writeTextFile(path, serializeProject(project));
    useProject.setState({ project });
    s.markSaved(path);
    if (isDesktop()) useSettings.getState().addRecent(path);
    useUi.getState().toast(`Saved ${baseName(path)}`, "success");
    await writeSession(false);
    return true;
  } catch (e) {
    useUi.getState().toast(`Save failed: ${String(e)}`, "error");
    return false;
  }
}

/** Unsaved-changes guard used by New/Open/Close. Returns true when it's OK to continue. */
export async function confirmDiscard(): Promise<boolean> {
  if (!useProject.getState().dirty) return true;
  if (isDesktop()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const save = await ask("Save changes to the current project?", { title: "MiniFX", kind: "warning", okLabel: "Save", cancelLabel: "Don't Save" });
    if (save) return saveProject(false);
    return true;
  }
  return window.confirm("Discard unsaved changes?");
}

// ---------------- import ----------------
export async function importFiles(files: PickedFile[]): Promise<void> {
  const ui = useUi.getState();
  const items: MediaItem[] = [];
  for (const f of files) {
    const kind = kindFromName(f.name);
    if (!kind) {
      ui.toast(`Unsupported file: ${f.name}`, "error");
      continue;
    }
    try {
      const info = await backend.probe(f.path, f.name);
      items.push({
        id: uid("media"),
        name: f.name,
        kind: info.kind,
        path: f.path,
        width: info.width,
        height: info.height,
        duration: info.duration,
        fps: info.fps || 30,
        hasAudio: info.hasAudio,
        codec: info.codec,
        size: info.size,
        status: isDesktop() && info.kind !== "audio" ? "processing" : "ready",
      });
    } catch (e) {
      ui.toast(`Could not read ${f.name}: ${String(e)}`, "error");
    }
  }
  addMedia(items);
  for (const m of items) void processMedia(m);
}

export async function importDialog(): Promise<void> {
  const files = await backend.pickMedia();
  if (files.length) await importFiles(files);
}

/** Thumbnails + proxies run in Rust/ffmpeg in the background; UI stays responsive. */
async function processMedia(m: MediaItem): Promise<void> {
  if (!isDesktop() || m.kind === "audio") return;
  try {
    const thumb = await backend.thumbnail(m.path, m.id);
    updateMedia(m.id, { thumbnail: thumb ?? undefined });
    const set = useSettings.getState();
    if (m.kind === "video" && set.proxyEnabled && m.height > set.proxyThresholdHeight) {
      useUi.getState().toast(`Creating proxy for ${m.name}…`);
      const proxy = await backend.proxy(m.path, m.id, set.proxyHeight);
      updateMedia(m.id, { proxyPath: proxy });
      useUi.getState().toast(`Proxy ready: ${m.name}`, "success");
    }
    updateMedia(m.id, { status: "ready" });
  } catch (e) {
    updateMedia(m.id, { status: "ready" });
    void backend.log(`media processing failed for ${m.path}: ${String(e)}`);
  }
}

async function refreshMediaStatus(): Promise<void> {
  if (!isDesktop()) return;
  for (const m of useProject.getState().project.media) {
    try {
      await backend.probe(m.path, m.name);
      if (m.status === "offline") updateMedia(m.id, { status: "ready" });
    } catch {
      updateMedia(m.id, { status: "offline" });
    }
  }
}

// ---------------- autosave & crash recovery ----------------
async function writeSession(cleanExit: boolean): Promise<void> {
  const s = useProject.getState();
  const session: Session = { cleanExit, filePath: s.filePath, projectName: s.project.name, savedAt: new Date().toISOString() };
  await backend.appDataWrite(SESSION, JSON.stringify(session));
}

let autosaveTimer: number | null = null;
let lastAutosavedRevision = -1;

export function startAutosave(): void {
  if (autosaveTimer) window.clearInterval(autosaveTimer);
  const minutes = Math.max(1, useSettings.getState().autosaveMinutes);
  autosaveTimer = window.setInterval(() => void autosaveNow(), minutes * 60_000);
}

export async function autosaveNow(): Promise<void> {
  const s = useProject.getState();
  if (s.revision === lastAutosavedRevision || useUi.getState().startScreen) return;
  lastAutosavedRevision = s.revision;
  await backend.appDataWrite(AUTOSAVE, serializeProject(s.project));
  await writeSession(false);
}

export async function checkRecovery(): Promise<Session | null> {
  try {
    const raw = await backend.appDataRead(SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (session.cleanExit) return null;
    const backup = await backend.appDataRead(AUTOSAVE);
    return backup ? session : null;
  } catch {
    return null;
  }
}

export async function recoverAutosave(): Promise<void> {
  const raw = await backend.appDataRead(AUTOSAVE);
  if (!raw) return;
  const session = await checkRecovery();
  const project = migrateProject(JSON.parse(raw));
  useProject.getState().load(project, session?.filePath ?? null);
  useProject.setState({ dirty: true });
  useUi.getState().set({ startScreen: false, dialog: null });
  useUi.getState().toast("Recovered project from autosave", "success");
}

export async function discardRecovery(): Promise<void> {
  await writeSession(true);
  await backend.appDataRemove(AUTOSAVE);
}

export async function markCleanExit(): Promise<void> {
  await writeSession(true);
}
