import { waitForConversions } from "./projectIO";
import { CompRenderer } from "../engine/renderer";
import type { Composition, Project } from "../engine/types";
import { useProject } from "../store/projectStore";
import { useUi, type ExportFormat, type RenderJob } from "../store/uiStore";
import { backend, isDesktop, type AudioClipSpec } from "./backend";

export const FORMATS: Record<ExportFormat, { label: string; ext: string; alpha: boolean; audio: boolean }> = {
  h264: { label: "MP4 · H.264", ext: "mp4", alpha: false, audio: true },
  h265: { label: "MP4 · H.265 (HEVC)", ext: "mp4", alpha: false, audio: true },
  prores422: { label: "MOV · ProRes 422", ext: "mov", alpha: false, audio: true },
  prores4444: { label: "MOV · ProRes 4444 + Alpha", ext: "mov", alpha: true, audio: true },
  vp9: { label: "WebM · VP9 + Alpha", ext: "webm", alpha: true, audio: true },
  gif: { label: "Animated GIF", ext: "gif", alpha: false, audio: false },
  png: { label: "PNG Sequence", ext: "png", alpha: true, audio: false },
};

export const PRESETS: { name: string; format: ExportFormat; height?: number; quality: number }[] = [
  { name: "YouTube 1080p (H.264)", format: "h264", height: 1080, quality: 20 },
  { name: "YouTube 4K (H.264)", format: "h264", height: 2160, quality: 18 },
  { name: "High efficiency (H.265)", format: "h265", quality: 24 },
  { name: "ProRes 422 (master)", format: "prores422", quality: 0 },
  { name: "ProRes 4444 with alpha", format: "prores4444", quality: 0 },
  { name: "WebM VP9 with alpha", format: "vp9", quality: 30 },
  { name: "GIF", format: "gif", quality: 0 },
  { name: "PNG sequence", format: "png", quality: 0 },
];

let running = false;
let cancelRequested: string | null = null;

function audioClips(project: Project, comp: Composition, range: [number, number]): AudioClipSpec[] {
  const media = new Map(project.media.map((m) => [m.id, m]));
  const anySolo = comp.layers.some((l) => l.solo);
  const clips: AudioClipSpec[] = [];
  for (const l of comp.layers) {
    if (!(l.kind === "audio" || l.kind === "video") || !l.audioEnabled || (anySolo && !l.solo)) continue;
    const m = l.sourceId ? media.get(l.sourceId) : undefined;
    if (!m || (l.kind === "video" && !m.hasAudio)) continue;
    const a = Math.max(l.inPoint, range[0]);
    const b = Math.min(l.outPoint, range[1]);
    if (b <= a) continue;
    clips.push({ path: m.path, compStart: a - range[0], srcStart: a - l.start, duration: b - a, volumeDb: l.volume ?? 0 });
  }
  return clips;
}

export function queueActiveComp(): void {
  const s = useProject.getState();
  const comp = s.project.compositions.find((c) => c.id === s.project.activeCompId);
  if (!comp) return;
  useUi.getState().addJob({
    compId: comp.id,
    compName: comp.name,
    format: "h264",
    outputPath: "",
    width: comp.width,
    height: comp.height,
    fps: comp.fps,
    range: [comp.workArea[0], comp.workArea[1]],
    quality: 20,
    includeAudio: true,
    openFolder: true,
  });
  useUi.getState().toast(`Added “${comp.name}” to the Render Queue`, "success");
}

export function cancelJob(id: string): void {
  const job = useUi.getState().jobs.find((j) => j.id === id);
  if (!job) return;
  if (job.status === "rendering" || job.status === "encoding") cancelRequested = id;
  else useUi.getState().updateJob(id, { status: "canceled", message: "Canceled" });
}

export async function runQueue(): Promise<void> {
  if (running) return;
  if (!isDesktop()) {
    useUi.getState().toast("Export runs in the desktop app (it uses the bundled FFmpeg).", "error");
    return;
  }
  running = true;
  try {
    for (;;) {
      const job = useUi.getState().jobs.find((j) => j.status === "queued");
      if (!job) break;
      await renderJob(job);
    }
  } finally {
    running = false;
  }
}

async function renderJob(job: RenderJob): Promise<void> {
  const ui = useUi.getState();
  ui.updateJob(job.id, { message: "Preparing footage…" });
  await waitForConversions();
  const project = useProject.getState().project;
  const comp = project.compositions.find((c) => c.id === job.compId);
  if (!comp) {
    ui.updateJob(job.id, { status: "failed", message: "Composition no longer exists" });
    return;
  }
  const fmt = FORMATS[job.format];
  let output = job.outputPath;
  if (!output) {
    const picked = await backend.pickExportPath(comp.name.replace(/[^\w\- ]+/g, "_"), fmt.ext);
    if (!picked) {
      ui.updateJob(job.id, { status: "canceled", message: "No output file chosen" });
      return;
    }
    output = picked;
    ui.updateJob(job.id, { outputPath: output });
  }
  const totalFrames = Math.max(1, Math.round((job.range[1] - job.range[0]) * job.fps));
  const width = job.width % 2 === 0 ? job.width : job.width + 1;
  const height = job.height % 2 === 0 ? job.height : job.height + 1;
  const renderComp: Composition = comp;
  // scale content when exporting at a different size than the comp
  const scaleX = width / comp.width;
  const scaleY = height / comp.height;

  const r = new CompRenderer(true);
  const canvas = document.createElement("canvas");
  let jobId = "";
  const started = performance.now();
  try {
    await r.init({ width, height, canvas, resolution: 1 });
    ui.updateJob(job.id, { status: "rendering", message: "Preparing media…", startedAt: Date.now(), progress: 0 });
    jobId = await backend.exportStart({
      output,
      format: job.format,
      width,
      height,
      fps: job.fps,
      quality: job.quality,
      audio: job.includeAudio && fmt.audio ? audioClips(project, comp, job.range) : [],
      totalFrames,
    });
    r.update(project, renderComp, job.range[0], { playing: false, exporting: true }, false);
    await r.media.waitReady();
    for (let i = 0; i < totalFrames; i++) {
      if (cancelRequested === job.id) throw new Error("__canceled__");
      const t = job.range[0] + i / job.fps;
      r.update(project, renderComp, t, { playing: false, exporting: true }, fmt.alpha);
      await r.seekVideos(project, renderComp, t);
      r.update(project, renderComp, t, { playing: false, exporting: true }, fmt.alpha);
      const pixels = await r.extractFrame(width, height, scaleX, scaleY);
      await backend.exportFrame(jobId, pixels);
      if (i % 3 === 0 || i === totalFrames - 1) {
        const elapsed = (performance.now() - started) / 1000;
        const perFrame = elapsed / (i + 1);
        ui.updateJob(job.id, { progress: (i + 1) / totalFrames, etaSeconds: Math.round(perFrame * (totalFrames - i - 1)), message: `Frame ${i + 1} / ${totalFrames}` });
      }
    }
    ui.updateJob(job.id, { status: "encoding", message: "Finishing encode…" });
    const result = await backend.exportFinish(jobId);
    const expected = totalFrames;
    const ok = job.format === "png" || Math.abs(result.frames - expected) <= 1;
    if (!ok) throw new Error(`Validation failed: expected ${expected} frames, file has ${result.frames}. See log: ${result.logPath}`);
    const secs = Math.round((performance.now() - started) / 100) / 10;
    ui.updateJob(job.id, { status: "done", progress: 1, etaSeconds: 0, message: `Done in ${secs}s · ${result.frames} frames · ${result.duration.toFixed(2)}s` });
    void backend.notify("MiniFX render finished", `${comp.name} → ${result.path}`);
    if (job.openFolder) void backend.reveal(result.path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (jobId) await backend.exportCancel(jobId).catch(() => undefined);
    if (msg === "__canceled__") ui.updateJob(job.id, { status: "canceled", message: "Canceled" });
    else {
      ui.updateJob(job.id, { status: "failed", message: msg });
      void backend.log(`export failed (${job.compName}): ${msg}`);
      void backend.notify("MiniFX render failed", msg);
    }
  } finally {
    if (cancelRequested === job.id) cancelRequested = null;
    r.destroy();
  }
}
