import { addLayer, addMedia, updateMedia } from "../commands";
import { activeComp } from "../store/projectStore";
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
export async function importFiles(files: PickedFile[], opts: { toTimeline?: boolean; at?: number } = {}): Promise<void> {
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
  if (!items.length) return;
  // Starting from the start screen: make a composition that matches the first clip.
  if (ui.startScreen || !activeComp(useProject.getState().project)) {
    const v = items.find((m) => m.kind === "video" || m.kind === "image");
    const total = items.reduce((t, m) => t + clipLength(m), 0);
    newProject({
      name: v ? v.name.replace(/\.[^.]+$/, "") : "Comp 1",
      width: v && v.width > 0 ? even(v.width) : 1920,
      height: v && v.height > 0 ? even(v.height) : 1080,
      fps: v && v.kind === "video" && v.fps > 0 ? Math.round(v.fps * 1000) / 1000 : 30,
      duration: Math.max(1, Math.ceil(total * 100) / 100),
    });
  }
  addMedia(items);
  if (opts.toTimeline !== false) placeOnTimeline(items, opts.at);
  for (const m of items) void processMedia(m);
}

const IMAGE_SECONDS = 5;
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
function clipLength(m: MediaItem): number {
  return m.kind === "image" || !(m.duration > 0) ? IMAGE_SECONDS : m.duration;
}

/** Like a video editor: clips go onto the timeline back-to-back from the playhead. */
function placeOnTimeline(items: MediaItem[], at?: number): void {
  const comp = activeComp(useProject.getState().project);
  if (!comp) return;
  let t = at ?? useProject.getState().currentTime;
  let end = 0;
  const ids: string[] = [];
  // audio-only files start at the same spot (music bed) instead of being chained
  const audioStart = t;
  for (const m of items) {
    const kind = m.kind === "audio" ? "audio" : m.kind === "image" ? "image" : "video";
    const start = kind === "audio" ? audioStart : t;
    const len = clipLength(m);
    const id = addLayer(kind, { media: m, start, duration: len });
    if (id) ids.push(id);
    if (kind !== "audio") t += len;
    end = Math.max(end, start + len);
  }
  if (end > comp.duration + 1e-3) {
    const grow = comp.workArea[1] >= comp.duration - 1e-3;
    useProject.getState().execute("Extend Composition", (p) => {
      const cc = p.compositions.find((x) => x.id === comp.id);
      if (!cc) return;
      cc.duration = Math.ceil(end * 100) / 100;
      if (grow) cc.workArea = [cc.workArea[0], cc.duration];
    });
  }
  if (ids.length) useProject.getState().selectLayers(ids);
}

export async function importDialog(): Promise<void> {
  const files = await backend.pickMedia();
  if (files.length) await importFiles(files);
}

/** Thumbnails + proxies run in Rust/ffmpeg in the background; UI stays responsive. */
export const FILMSTRIP_FRAMES = 24;

/** Footage conversions in flight; export waits for them so it never renders black frames. */
const conversions = new Set<Promise<void>>();
export async function waitForConversions(): Promise<void> {
  while (conversions.size) {
    const all = [...conversions];
    await Promise.all(all);
    for (const p of all) conversions.delete(p);
  }
}

async function processMedia(m: MediaItem): Promise<void> {
  if (m.kind === "video") {
    // filmstrip first: it is what the timeline shows
    void backend
      .filmstrip(m.path, m.id, m.duration, FILMSTRIP_FRAMES)
      .then((strip) => strip && updateMedia(m.id, { filmstrip: strip, filmstripFrames: FILMSTRIP_FRAMES }))
      .catch((e) => void backend.log(`filmstrip failed for ${m.path}: ${String(e)}`));
  }
  if (m.kind === "video") {
    const decodable = await backend.canDecode(backend.mediaUrl(m.path), "video");
    void backend.log(`decode check ${m.name} (${m.codec}): ${decodable}`);
    if (decodable === "no") {
      if (!isDesktop()) {
        useUi.getState().toast(`${m.name}: this browser cannot decode ${m.codec || "this codec"}. Use the desktop app, or convert to H.264/VP9.`, "error");
      } else {
        useUi.getState().toast(`Converting ${m.name} (${m.codec}) so it can play in the viewer…`);
        let release = (): void => undefined;
        conversions.add(new Promise<void>((r) => (release = r)));
        try {
          const h = Math.min(m.height > 0 ? m.height : 1080, 2160);
          const playable = await backend.proxy(m.path, m.id, h - (h % 2), 18);
          updateMedia(m.id, { playablePath: playable });
          useUi.getState().toast(`${m.name} is ready to play`, "success");
        } catch (e) {
          useUi.getState().toast(`Could not convert ${m.name}: ${String(e)}`, "error");
        } finally {
          release();
        }
      }
    }
  }
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
