// One interface for everything that touches the OS. On desktop it talks to the
// Rust side through Tauri; in a plain browser (npm run dev) it falls back to web
// APIs so the UI can be developed and tested without the desktop shell.
import { convertFileSrc } from "@tauri-apps/api/core";
import type { MediaKind } from "../engine/types";

export interface MediaInfo {
  kind: MediaKind;
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
  size: number;
}

export interface PickedFile {
  path: string;
  name: string;
}

export interface AudioClipSpec {
  path: string;
  compStart: number;
  srcStart: number;
  duration: number;
  volumeDb: number;
}

export interface ExportSpec {
  output: string;
  format: string;
  width: number;
  height: number;
  fps: number;
  quality: number;
  audio: AudioClipSpec[];
  totalFrames: number;
}

export interface ExportResult {
  frames: number;
  duration: number;
  path: string;
  logPath: string;
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpg", "mpeg", "wmv"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff"];
const AUDIO_EXT = ["mp3", "wav", "aac", "m4a", "ogg", "flac", "opus"];
export const MEDIA_EXTENSIONS = [...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT];

export function kindFromName(name: string): MediaKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return null;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  return core;
}

// ---------- browser fallback helpers ----------
const browserFiles = new Map<string, File>();

function pickBrowserFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

function browserProbe(url: string, kind: MediaKind): Promise<MediaInfo> {
  return new Promise((resolve) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve({ kind, width: img.naturalWidth, height: img.naturalHeight, duration: 0, fps: 0, hasAudio: false, codec: "image", size: 0 });
      img.onerror = () => resolve({ kind, width: 100, height: 100, duration: 0, fps: 0, hasAudio: false, codec: "?", size: 0 });
      img.src = url;
      return;
    }
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      resolve({ kind, width: v.videoWidth || 0, height: v.videoHeight || 0, duration: el.duration || 0, fps: 30, hasAudio: true, codec: "browser", size: 0 });
    };
    el.onerror = () => resolve({ kind, width: 0, height: 0, duration: 0, fps: 30, hasAudio: false, codec: "?", size: 0 });
    el.src = url;
  });
}

function download(name: string, content: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  a.download = name;
  a.click();
}

// ---------- public API ----------
export const backend = {
  isDesktopApp(): boolean {
    return isDesktop();
  },

  async appDataRead(name: string): Promise<string | null> {
    if (!isDesktop()) return localStorage.getItem(`minifx:${name}`);
    const { invoke } = await tauri();
    return invoke<string | null>("app_data_read", { name });
  },

  async appDataWrite(name: string, content: string): Promise<void> {
    if (!isDesktop()) {
      localStorage.setItem(`minifx:${name}`, content);
      return;
    }
    const { invoke } = await tauri();
    await invoke("app_data_write", { name, content });
  },

  async appDataRemove(name: string): Promise<void> {
    if (!isDesktop()) {
      localStorage.removeItem(`minifx:${name}`);
      return;
    }
    const { invoke } = await tauri();
    await invoke("app_data_remove", { name });
  },

  async readTextFile(path: string): Promise<string> {
    if (!isDesktop()) {
      const f = browserFiles.get(path);
      if (!f) throw new Error("File not available in browser mode");
      return f.text();
    }
    const { invoke } = await tauri();
    return invoke<string>("read_text_file", { path });
  },

  async writeTextFile(path: string, content: string): Promise<void> {
    if (!isDesktop()) {
      download(baseName(path), content);
      return;
    }
    const { invoke } = await tauri();
    await invoke("write_text_file", { path, content });
  },

  async openProjectDialog(): Promise<string | null> {
    if (!isDesktop()) {
      const [f] = await pickBrowserFiles(".msproj,.json", false);
      if (!f) return null;
      browserFiles.set(f.name, f);
      return f.name;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, filters: [{ name: "MiniFX Project", extensions: ["msproj"] }] });
    return typeof r === "string" ? r : null;
  },

  async saveProjectDialog(defaultName: string): Promise<string | null> {
    if (!isDesktop()) return `${defaultName}.msproj`;
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath: `${defaultName}.msproj`, filters: [{ name: "MiniFX Project", extensions: ["msproj"] }] });
  },

  async pickMedia(): Promise<PickedFile[]> {
    if (!isDesktop()) {
      const files = await pickBrowserFiles(MEDIA_EXTENSIONS.map((e) => `.${e}`).join(","), true);
      return files.map((f) => {
        const url = URL.createObjectURL(f);
        browserFiles.set(url, f);
        return { path: url, name: f.name };
      });
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: true, filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }] });
    const list = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    return list.map((p) => ({ path: p, name: baseName(p) }));
  },

  async pickExportPath(defaultName: string, ext: string): Promise<string | null> {
    if (!isDesktop()) return `${defaultName}.${ext}`;
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath: `${defaultName}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  },

  async probe(path: string, name: string): Promise<MediaInfo> {
    const kind = kindFromName(name) ?? "video";
    if (!isDesktop()) return browserProbe(path, kind);
    const { invoke } = await tauri();
    return invoke<MediaInfo>("probe_media", { path });
  },

  async thumbnail(path: string, id: string): Promise<string | null> {
    if (!isDesktop()) return null;
    const { invoke } = await tauri();
    const out = await invoke<string | null>("make_thumbnail", { path, id });
    return out ? backend.mediaUrl(out) : null;
  },

  async proxy(path: string, id: string, height: number): Promise<string> {
    const { invoke } = await tauri();
    return invoke<string>("make_proxy", { path, id, height });
  },

  async waveform(path: string, buckets: number): Promise<number[]> {
    if (!isDesktop()) return [];
    const { invoke } = await tauri();
    return invoke<number[]>("audio_waveform", { path, buckets });
  },

  mediaUrl(path: string): string {
    if (!isDesktop() || path.startsWith("blob:") || path.startsWith("http")) return path;
    return convertFileSrc(path);
  },

  async exportStart(spec: ExportSpec): Promise<string> {
    if (!isDesktop()) throw new Error("Export needs the desktop app (FFmpeg runs on your PC).");
    const { invoke } = await tauri();
    return invoke<string>("export_start", { spec });
  },

  async exportFrame(jobId: string, rgba: Uint8Array): Promise<void> {
    const { invoke } = await tauri();
    await invoke("export_frame", rgba, { headers: { "x-job-id": jobId } });
  },

  async exportFinish(jobId: string): Promise<ExportResult> {
    const { invoke } = await tauri();
    return invoke<ExportResult>("export_finish", { jobId });
  },

  async exportCancel(jobId: string): Promise<void> {
    if (!isDesktop()) return;
    const { invoke } = await tauri();
    await invoke("export_cancel", { jobId });
  },

  async reveal(path: string): Promise<void> {
    if (!isDesktop()) return;
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  },

  async notify(title: string, body: string): Promise<void> {
    if (!isDesktop()) return;
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (ok) n.sendNotification({ title, body });
  },

  async launchFile(): Promise<string | null> {
    if (!isDesktop()) return null;
    const { invoke } = await tauri();
    return invoke<string | null>("get_launch_file");
  },

  async log(line: string): Promise<void> {
    if (!isDesktop()) {
      console.warn(line);
      return;
    }
    const { invoke } = await tauri();
    await invoke("write_log", { line });
  },

  async openDevtools(): Promise<void> {
    if (!isDesktop()) return;
    const { invoke } = await tauri();
    await invoke("open_devtools");
  },

  async revealLogs(): Promise<void> {
    if (!isDesktop()) return;
    const { invoke } = await tauri();
    const path = await invoke<string>("get_log_dir");
    await invoke("write_log", { line: "log folder opened" });
    await backend.reveal(path);
  },

  async windowAction(action: "minimize" | "toggleMaximize" | "close"): Promise<void> {
    if (!isDesktop()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (action === "minimize") await w.minimize();
    else if (action === "toggleMaximize") await w.toggleMaximize();
    else await w.close();
  },

  async onCloseRequested(handler: () => Promise<boolean>): Promise<void> {
    if (!isDesktop()) {
      window.addEventListener("beforeunload", (e) => {
        void handler();
        e.preventDefault();
      });
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.onCloseRequested(async (event) => {
      const allow = await handler();
      if (!allow) event.preventDefault();
    });
  },

  async onFileDrop(cb: (paths: string[]) => void): Promise<void> {
    if (!isDesktop()) return;
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") cb(e.payload.paths);
    });
  },

  registerBrowserFile(file: File): string {
    const url = URL.createObjectURL(file);
    browserFiles.set(url, file);
    return url;
  },
};
