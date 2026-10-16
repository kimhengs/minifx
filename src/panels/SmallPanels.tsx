import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Repeat, Zap, FolderOpen, X, RotateCcw, History as HistoryIcon, Sparkles } from "lucide-react";
import * as cmd from "../commands";
import { applyPreset, PRESETS } from "../commands/presets";
import { EFFECTS } from "../engine/effects";
import { formatTimecode } from "../engine/factory";
import { cancelJob, FORMATS, PRESETS as EXPORT_PRESETS, runQueue } from "../lib/exporter";
import { backend } from "../lib/backend";
import { perf } from "../lib/perf";
import { activeComp, useProject } from "../store/projectStore";
import { useUi, type ExportFormat } from "../store/uiStore";
import { Check, ColorField, Empty, Row, ScrubNumber, Select } from "../app/ui";
import { play, stepFrames, stop, togglePlay } from "../app/playback";
import { frameCache, ramPreview } from "../app/ramPreview";

// ---------------- Effects & Presets ----------------
export function EffectsPresetsPanel() {
  const [q, setQ] = useState("");
  const query = q.toLowerCase();
  const groups = useMemo(() => {
    const m = new Map<string, typeof EFFECTS>();
    for (const e of EFFECTS) {
      if (query && !e.name.toLowerCase().includes(query) && !e.category.toLowerCase().includes(query)) continue;
      m.set(e.category, [...(m.get(e.category) ?? []), e]);
    }
    return m;
  }, [query]);
  const presets = PRESETS.filter((p) => !query || p.name.toLowerCase().includes(query));
  const applyFx = (type: string): void => {
    const ids = useProject.getState().selectedLayerIds;
    if (!ids.length) return useUi.getState().toast("Select a layer first, or drag the effect onto a layer.", "error");
    cmd.addEffect(ids, type);
  };
  return (
    <div className="panel-root">
      <div className="panel-bar">
        <input className="field flex-1" placeholder="Search effects & presets" aria-label="Search effects" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-2 pt-1 pb-0.5 text-[11px] uppercase tracking-wide text-muted">* Animation Presets</div>
        {presets.map((p) => (
          <button key={p.id} type="button" className="w-full text-left px-5 h-[22px] border-0 bg-transparent hover:bg-[#2a2a2a]" onDoubleClick={() => { const n = applyPreset(p.id); if (!n) useUi.getState().toast("Select a layer first.", "error"); }} title="Double-click to apply at the current time">
            {p.name}
          </button>
        ))}
        {[...groups.entries()].map(([cat, list]) => (
          <div key={cat}>
            <div className="px-2 pt-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted">{cat}</div>
            {list.map((e) => (
              <button
                key={e.type}
                type="button"
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData("application/x-minifx-effect", e.type)}
                className="w-full text-left px-5 h-[22px] border-0 bg-transparent hover:bg-[#2a2a2a] cursor-grab"
                onDoubleClick={() => applyFx(e.type)}
                title="Double-click to apply to selected layers, or drag onto a layer"
              >
                {e.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Character (text) + shape contents ----------------
const FONTS = ["Inter", "Kantumruy Pro", "JetBrains Mono", "Arial", "Georgia", "Impact", "Segoe UI", "Times New Roman"];

export function CharacterPanel() {
  const comp = useProject((s) => activeComp(s.project));
  const id = useProject((s) => s.selectedLayerIds[0]);
  const layer = comp?.layers.find((l) => l.id === id);
  if (!layer || (!layer.text && !layer.shape)) return <Empty>Select a text or shape layer.</Empty>;
  if (layer.shape) {
    const sh = layer.shape;
    return (
      <div className="panel-root overflow-y-auto py-2">
        <Row label="Shape">
          <Select label="Shape type" value={sh.kind} options={[{ value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }, { value: "polygon", label: "Polygon" }, { value: "path", label: "Path" }]} onChange={(v) => cmd.updateShape(layer.id, { kind: v })} />
        </Row>
        {sh.kind === "polygon" && <Row label="Points"><ScrubNumber label="Points" value={sh.points} min={3} max={64} step={1} onChange={(v) => cmd.updateShape(layer.id, { points: Math.round(v) })} gestureKey={`pts:${layer.id}`} /></Row>}
        {sh.kind === "rect" && <Row label="Roundness"><ScrubNumber label="Roundness" value={sh.roundness} min={0} max={1000} step={1} onChange={(v) => cmd.updateShape(layer.id, { roundness: v })} gestureKey={`rnd:${layer.id}`} /></Row>}
        <Row label="Fill"><Check label="" checked={sh.fillEnabled} onChange={(v) => cmd.updateShape(layer.id, { fillEnabled: v })} /><ColorField label="Fill" value={sh.fill} onChange={(v) => cmd.updateShape(layer.id, { fill: v })} /></Row>
        <Row label="Stroke"><ColorField label="Stroke" value={sh.stroke} onChange={(v) => cmd.updateShape(layer.id, { stroke: v })} /></Row>
        <Row label="Stroke Width"><ScrubNumber label="Stroke width" value={sh.strokeWidth} min={0} max={200} step={0.5} suffix=" px" onChange={(v) => cmd.updateShape(layer.id, { strokeWidth: v })} gestureKey={`sw:${layer.id}`} /></Row>
      </div>
    );
  }
  const td = layer.text;
  if (!td) return null;
  return (
    <div className="panel-root overflow-y-auto py-2">
      <div className="px-2 pb-2">
        <textarea aria-label="Text" className="field w-full" style={{ height: 60, fontFamily: td.font }} value={td.text} onChange={(e) => cmd.updateText(layer.id, { text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <Row label="Font"><Select label="Font" value={td.font} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(v) => cmd.updateText(layer.id, { font: v })} width={150} /></Row>
      <Row label="Weight"><Select label="Weight" value={String(td.weight)} options={["300", "400", "500", "600", "700", "800"].map((w) => ({ value: w, label: w }))} onChange={(v) => cmd.updateText(layer.id, { weight: Number(v) })} /></Row>
      <Row label="Size"><ScrubNumber label="Font size" value={td.size} min={1} max={1000} step={1} suffix=" px" onChange={(v) => cmd.updateText(layer.id, { size: v })} gestureKey={`fs:${layer.id}`} /></Row>
      <Row label="Tracking"><ScrubNumber label="Tracking" value={td.tracking} min={-50} max={200} step={0.5} onChange={(v) => cmd.updateText(layer.id, { tracking: v })} gestureKey={`tr:${layer.id}`} /></Row>
      <Row label="Leading"><ScrubNumber label="Leading" value={td.leading} min={50} max={300} step={1} suffix="%" onChange={(v) => cmd.updateText(layer.id, { leading: v })} gestureKey={`ld:${layer.id}`} /></Row>
      <Row label="Fill"><ColorField label="Fill color" value={td.fill} onChange={(v) => cmd.updateText(layer.id, { fill: v })} /></Row>
      <Row label="Stroke"><ColorField label="Stroke color" value={td.stroke} onChange={(v) => cmd.updateText(layer.id, { stroke: v })} /><ScrubNumber label="Stroke width" value={td.strokeWidth} min={0} max={50} step={0.5} suffix=" px" onChange={(v) => cmd.updateText(layer.id, { strokeWidth: v })} gestureKey={`ts:${layer.id}`} /></Row>
      <Row label="Align"><Select label="Align" value={td.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} onChange={(v) => cmd.updateText(layer.id, { align: v })} /></Row>
      <div className="px-3 pt-2 text-[11px] text-muted">Tip: double-click text in the viewer to edit it on the canvas.</div>
    </div>
  );
}

// ---------------- Info ----------------
export function InfoPanel() {
  const comp = useProject((s) => activeComp(s.project));
  const time = useProject((s) => s.currentTime);
  const sel = useProject((s) => s.selectedLayerIds);
  const cursor = useUi((s) => s.cursor);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const layer = comp?.layers.find((l) => l.id === sel[0]);
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return (
    <div className="panel-root p-3 gap-1 text-[12px] leading-[20px]">
      <div className="mono">X: {cursor ? cursor[0] : "–"} &nbsp; Y: {cursor ? cursor[1] : "–"}</div>
      {comp && <div className="mono">{formatTimecode(time, comp.fps)} · frame {Math.round(time * comp.fps)}</div>}
      {comp && <div className="text-muted">{comp.width}×{comp.height} · {comp.fps} fps · {comp.duration}s · {comp.layers.length} layers</div>}
      {layer && (
        <div className="mt-2">
          <div className="font-medium">{layer.name}</div>
          <div className="text-muted">{layer.kind} · In {formatTimecode(layer.inPoint, comp?.fps ?? 30)} · Out {formatTimecode(layer.outPoint, comp?.fps ?? 30)}</div>
          <div className="text-muted">Duration {formatTimecode(layer.outPoint - layer.inPoint, comp?.fps ?? 30)}</div>
        </div>
      )}
      <div className="mt-3 border-t border-line pt-2 text-muted mono text-[11px]" data-tick={tick}>
        <div>Startup: {perf.startupMs()} ms</div>
        <div>Viewer: {perf.fps} fps · render {perf.renderMs.toFixed(1)} ms</div>
        <div>RAM cache: {frameCache.count()} frames · {(frameCache.bytes() / 1048576).toFixed(0)} MB</div>
        {mem && <div>JS heap: {(mem.usedJSHeapSize / 1048576).toFixed(0)} MB</div>}
      </div>
    </div>
  );
}

// ---------------- Preview ----------------
export function PreviewPanel() {
  const ui = useUi(useShallow((s) => ({ cachedFrames: s.cachedFrames, loop: s.loop, playing: s.playing, set: s.set })));
  const comp = useProject((s) => activeComp(s.project));
  if (!comp) return <Empty>No composition.</Empty>;
  const total = Math.round((comp.workArea[1] - comp.workArea[0]) * comp.fps);
  const cachedInWork = [...ui.cachedFrames].filter((f) => f >= comp.workArea[0] * comp.fps && f < comp.workArea[1] * comp.fps).length;
  return (
    <div className="panel-root p-2 gap-2">
      <div className="flex items-center justify-center gap-1">
        <button type="button" className="icon-btn" aria-label="First frame" onClick={() => { stop(); useProject.getState().setTime(comp.workArea[0]); }}><SkipBack size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Previous frame" onClick={() => stepFrames(-1)}><StepBack size={15} /></button>
        <button type="button" className="icon-btn" style={{ width: 34, height: 30 }} aria-label={ui.playing ? "Stop" : "Play"} onClick={togglePlay}>{ui.playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button type="button" className="icon-btn" aria-label="Next frame" onClick={() => stepFrames(1)}><StepForward size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Last frame" onClick={() => { stop(); useProject.getState().setTime(comp.workArea[1]); }}><SkipForward size={15} /></button>
        <button type="button" className="icon-btn" data-on={ui.loop} aria-label="Loop" onClick={() => ui.set({ loop: !ui.loop })}><Repeat size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Play backward" onClick={() => play(-1)} title="Play backward (J)">◀</button>
      </div>
      <button type="button" className="btn flex items-center justify-center gap-1" onClick={() => void ramPreview()} title="Render the work area to RAM, then play in real time (Ctrl+Space)">
        <Zap size={13} /> RAM Preview
      </button>
      <div className="text-[11px] text-muted text-center">
        Cached {cachedInWork}/{total} frames · <button type="button" className="underline bg-transparent border-0 text-muted p-0" onClick={() => frameCache.clear()}>Purge</button>
      </div>
    </div>
  );
}

// ---------------- History ----------------
export function HistoryPanel() {
  const past = useProject((s) => s.past);
  const future = useProject((s) => s.future);
  return (
    <div className="panel-root">
      <div className="panel-bar"><HistoryIcon size={13} /> <span className="text-muted">{past.length} steps · max 200</span></div>
      <div className="flex-1 overflow-y-auto">
        <button type="button" className="w-full text-left px-3 h-[22px] border-0 bg-transparent hover:bg-[#2a2a2a]" style={{ color: past.length === 0 ? "#fff" : "#999" }} onClick={() => useProject.getState().jumpToHistory(0)}>
          Open / New Project
        </button>
        {past.map((e, i) => (
          <button key={e.id} type="button" className="w-full text-left px-3 h-[22px] border-0 hover:bg-[#2a2a2a]" style={{ background: i === past.length - 1 ? "#2b3340" : "transparent" }} onClick={() => useProject.getState().jumpToHistory(i + 1)}>
            {e.label}
          </button>
        ))}
        {future.map((e, i) => (
          <button key={e.id} type="button" className="w-full text-left px-3 h-[22px] border-0 bg-transparent hover:bg-[#2a2a2a] text-[#666]" onClick={() => useProject.getState().jumpToHistory(past.length + i + 1)}>
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Render Queue ----------------
export function RenderQueuePanel() {
  const jobs = useUi((s) => s.jobs);
  const ui = useUi.getState();
  const active = jobs.some((j) => j.status === "rendering" || j.status === "encoding");
  return (
    <div className="panel-root">
      <div className="panel-bar">
        <button type="button" className="btn" onClick={() => import("../lib/exporter").then((m) => m.queueActiveComp())}>+ Add Active Comp (Ctrl+M)</button>
        <span className="flex-1" />
        <button type="button" className="btn btn-primary" disabled={active || !jobs.some((j) => j.status === "queued")} onClick={() => void runQueue()}>Render</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {jobs.length === 0 && <Empty>Add a composition with Composition › Add to Render Queue (Ctrl+M).</Empty>}
        {jobs.map((j) => {
          const fmt = FORMATS[j.format];
          const locked = j.status !== "queued";
          return (
            <div key={j.id} className="border-b border-line p-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium flex-1 truncate">{j.compName}</span>
                <span className="text-[11px]" style={{ color: j.status === "done" ? "var(--ok)" : j.status === "failed" ? "var(--danger)" : "var(--muted)" }}>{j.status.toUpperCase()}</span>
                {(j.status === "rendering" || j.status === "encoding") && <button type="button" className="btn" style={{ height: 20 }} onClick={() => cancelJob(j.id)}>Cancel</button>}
                {j.status === "done" && <button type="button" className="icon-btn" aria-label="Open folder" onClick={() => void backend.reveal(j.outputPath)}><FolderOpen size={13} /></button>}
                {(j.status === "failed" || j.status === "canceled") && <button type="button" className="icon-btn" aria-label="Retry" onClick={() => ui.updateJob(j.id, { status: "queued", progress: 0, message: "Queued" })}><RotateCcw size={13} /></button>}
                {!(j.status === "rendering" || j.status === "encoding") && <button type="button" className="icon-btn" aria-label="Remove" onClick={() => ui.removeJob(j.id)}><X size={13} /></button>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select<ExportFormat> label="Output format" width={200} value={j.format} options={(Object.keys(FORMATS) as ExportFormat[]).map((f) => ({ value: f, label: FORMATS[f].label }))} onChange={(v) => !locked && ui.updateJob(j.id, { format: v, outputPath: "" })} />
                <Select
                  label="Preset"
                  width={190}
                  value=""
                  options={[{ value: "", label: "Preset…" }, ...EXPORT_PRESETS.map((p) => ({ value: p.name, label: p.name }))]}
                  onChange={(name) => {
                    const p = EXPORT_PRESETS.find((x) => x.name === name);
                    if (!p || locked) return;
                    const h = p.height ?? j.height;
                    const w = Math.round((j.width / j.height) * h);
                    ui.updateJob(j.id, { format: p.format, quality: p.quality, height: h, width: w, outputPath: "" });
                  }}
                />
                <span className="text-muted">Size</span>
                <ScrubNumber label="Width" value={j.width} min={16} max={7680} step={2} onChange={(v) => !locked && ui.updateJob(j.id, { width: Math.round(v / 2) * 2 })} />
                ×
                <ScrubNumber label="Height" value={j.height} min={16} max={4320} step={2} onChange={(v) => !locked && ui.updateJob(j.id, { height: Math.round(v / 2) * 2 })} />
                {(j.format === "h264" || j.format === "h265" || j.format === "vp9") && (
                  <>
                    <span className="text-muted">CRF</span>
                    <ScrubNumber label="Quality CRF" value={j.quality} min={0} max={51} step={1} onChange={(v) => !locked && ui.updateJob(j.id, { quality: Math.round(v) })} />
                  </>
                )}
                {fmt.audio && <Check label="Audio" checked={j.includeAudio} onChange={(v) => ui.updateJob(j.id, { includeAudio: v })} />}
                <Check label="Open folder when done" checked={j.openFolder} onChange={(v) => ui.updateJob(j.id, { openFolder: v })} />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span className="truncate flex-1" title={j.outputPath}>{j.outputPath || "Output file chosen when rendering starts"}</span>
                {!locked && <button type="button" className="btn" style={{ height: 20 }} onClick={() => void backend.pickExportPath(j.compName, fmt.ext).then((p) => p && ui.updateJob(j.id, { outputPath: p }))}>Output…</button>}
              </div>
              {j.status !== "queued" && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-[6px] bg-[#2a2a2a] rounded"><div className="h-full rounded" style={{ width: `${Math.round(j.progress * 100)}%`, background: j.status === "failed" ? "var(--danger)" : "var(--accent)" }} /></div>
                  <span className="mono text-[11px] w-[34px] text-right">{Math.round(j.progress * 100)}%</span>
                  {j.etaSeconds !== null && j.status === "rendering" && <span className="mono text-[11px] text-muted">ETA {Math.floor(j.etaSeconds / 60)}:{String(j.etaSeconds % 60).padStart(2, "0")}</span>}
                </div>
              )}
              <div className="text-[11px]" style={{ color: j.status === "failed" ? "var(--danger)" : "var(--muted)" }}>{j.message}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AiIcon() {
  return <Sparkles size={13} />;
}
