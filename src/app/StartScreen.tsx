import { FilePlus2, FolderOpen, Clock, Smartphone, Monitor, Square as SquareIcon } from "lucide-react";
import { baseName, isDesktop } from "../lib/backend";
import { newProject, openProject } from "../lib/projectIO";
import { useSettings } from "../store/settingsStore";

const PRESETS = [
  { name: "HD 1080p", w: 1920, h: 1080, fps: 30, icon: <Monitor size={18} /> },
  { name: "TikTok / Reels", w: 1080, h: 1920, fps: 30, icon: <Smartphone size={18} /> },
  { name: "Square", w: 1080, h: 1080, fps: 30, icon: <SquareIcon size={18} /> },
  { name: "4K UHD", w: 3840, h: 2160, fps: 30, icon: <Monitor size={18} /> },
];

export function StartScreen() {
  const recent = useSettings((s) => s.recentFiles);
  return (
    <div className="flex-1 flex items-center justify-center bg-base">
      <div className="w-[760px] max-w-[94vw] flex gap-8">
        <div className="flex-1 flex flex-col gap-4">
          <div>
            <div className="text-[28px] font-semibold">MiniFX</div>
            <div className="text-muted">Motion graphics & video effects · v0.1</div>
          </div>
          <button type="button" className="btn btn-primary h-[36px] flex items-center gap-2 justify-center text-[13px]" onClick={() => newProject()}>
            <FilePlus2 size={16} /> New Project
          </button>
          <button type="button" className="btn h-[36px] flex items-center gap-2 justify-center text-[13px]" onClick={() => void openProject()}>
            <FolderOpen size={16} /> Open Project…
          </button>
          <div className="text-[11px] uppercase tracking-wide text-muted mt-2">Start with a composition</div>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" className="btn h-auto py-2 flex items-center gap-2 text-left" onClick={() => newProject({ name: p.name, width: p.w, height: p.h, fps: p.fps, duration: 10 })}>
                {p.icon}
                <span className="flex flex-col">
                  <span>{p.name}</span>
                  <span className="text-[11px] text-muted mono">{p.w}×{p.h} · {p.fps}fps</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="w-[320px] flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted flex items-center gap-1"><Clock size={12} /> Recent projects</div>
          <div className="bg-panel border border-line rounded flex-1 min-h-[240px] overflow-y-auto">
            {recent.length === 0 && <div className="text-muted p-4">{isDesktop() ? "Projects you open or save appear here." : "Recent files are available in the desktop app."}</div>}
            {recent.map((p) => (
              <button key={p} type="button" className="w-full text-left px-3 py-2 border-0 bg-transparent hover:bg-[#2a2a2a] flex flex-col" onClick={() => void openProject(p)} title={p}>
                <span>{baseName(p)}</span>
                <span className="text-[11px] text-muted truncate">{p}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
