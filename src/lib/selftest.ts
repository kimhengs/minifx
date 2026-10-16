// Headless end-to-end check used by CI/dev: when MINIFX_SELFTEST_OUT is set,
// the desktop app builds a tiny comp, exports it through the real FFmpeg
// pipeline, logs the result and quits.
import * as cmd from "../commands";
import { applyPreset } from "../commands/presets";
import { useProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";
import { backend, isDesktop } from "./backend";
import { runQueue } from "./exporter";
import { importFiles, newProject } from "./projectIO";

export async function maybeRunSelfTest(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const out = await invoke<string | null>("selftest_output");
  if (!out) return;
  try {
    newProject({ name: "SelfTest", width: 640, height: 360, fps: 30, duration: 2 });
    cmd.addLayer("solid", { color: "#203a5c", start: 0 });
    const video = await invoke<string | null>("selftest_video");
    if (video) {
      // real footage: import → timeline (exercises probe, filmstrip, decode, texture upload)
      await importFiles([{ path: video, name: video.split(/[\\/]/).pop() ?? video }], { at: 0 });
      for (let i = 0; i < 60 && !useProject.getState().project.media[0]?.filmstrip; i++) await new Promise((r) => setTimeout(r, 250));
      const m = useProject.getState().project.media[0];
      await backend.log(`SELFTEST media: ${m?.name} ${m?.width}x${m?.height} ${m?.duration}s filmstrip=${m?.filmstrip ? "yes" : "no"} playable=${m?.playablePath ? "converted" : "native"}`);
    }
    const t = cmd.addLayer("text", { text: "MiniFX", start: 0 });
    if (t) {
      cmd.addEffect([t], "glow");
      applyPreset("fadeIn", [t]);
    }
    const s = useProject.getState();
    const comp = s.project.compositions[0];
    useUi.getState().addJob({ compId: comp.id, compName: comp.name, format: "h264", outputPath: out, width: 640, height: 360, fps: 30, range: [0, 2], quality: 23, includeAudio: !!video, openFolder: false });
    await runQueue();
    const job = useUi.getState().jobs[0];
    await backend.log(`SELFTEST ${job?.status ?? "missing"}: ${job?.message ?? ""}`);
  } catch (e) {
    await backend.log(`SELFTEST error: ${String(e)}`);
  }
  useProject.setState({ dirty: false });
  await invoke("selftest_exit");
}
