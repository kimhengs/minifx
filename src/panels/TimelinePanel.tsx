import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, Circle, CircleDot, LineChart, Magnet, Diamond, ChevronLeft, ChevronRight as Next, Volume2, VolumeX } from "lucide-react";
import * as cmd from "../commands";
import { effectDef, type ParamDef } from "../engine/effects";
import { formatTimecode, snapToFrame } from "../engine/factory";
import { scalarOf, speedAt, valueAt, isVec2 } from "../engine/interpolation";
import type { AnimProp, Composition, Keyframe, Layer, ParamValue, Vec2 } from "../engine/types";
import { activeComp, getProp, TRANSFORM_PATHS, useProject, type KeySelection } from "../store/projectStore";
import { useUi } from "../store/uiStore";
import { ColorField, Empty, LABEL_COLORS, ScrubNumber, Stopwatch, useElementSize } from "../app/ui";
import { stop } from "../app/playback";

const ROW_H = 22;
const RULER_H = 34;
const LEFT_W = 380;

type Row =
  | { type: "layer"; layer: Layer; index: number }
  | { type: "group"; layer: Layer; label: string; depth: number }
  | { type: "prop"; layer: Layer; path: string; label: string; def?: ParamDef; depth: number };

const PROP_LABELS: Record<string, string> = {
  "transform.anchor": "Anchor Point",
  "transform.position": "Position",
  "transform.scale": "Scale",
  "transform.rotation": "Rotation",
  "transform.opacity": "Opacity",
  "shape.size": "Size",
};

function buildRows(comp: Composition, expanded: Record<string, boolean>, reveal: Record<string, string[] | undefined>): Row[] {
  const rows: Row[] = [];
  comp.layers.forEach((layer, index) => {
    rows.push({ type: "layer", layer, index });
    if (!expanded[layer.id]) return;
    const only = reveal[layer.id];
    if (only) {
      for (const p of only) rows.push({ type: "prop", layer, path: p, label: propName(layer, p), depth: 1, def: paramDef(layer, p) });
      return;
    }
    if (layer.kind !== "audio") {
      rows.push({ type: "group", layer, label: "Transform", depth: 1 });
      for (const p of TRANSFORM_PATHS) rows.push({ type: "prop", layer, path: p, label: PROP_LABELS[p], depth: 2 });
    }
    if (layer.shape) {
      rows.push({ type: "group", layer, label: "Contents", depth: 1 });
      rows.push({ type: "prop", layer, path: "shape.size", label: "Size", depth: 2 });
    }
    if (layer.effects.length) {
      rows.push({ type: "group", layer, label: "Effects", depth: 1 });
      for (const fx of layer.effects) {
        const def = effectDef(fx.type);
        rows.push({ type: "group", layer, label: def?.name ?? fx.type, depth: 2 });
        for (const pd of def?.params ?? []) rows.push({ type: "prop", layer, path: `fx.${fx.id}.${pd.key}`, label: pd.label, def: pd, depth: 3 });
      }
    }
  });
  return rows;
}

function paramDef(layer: Layer, path: string): ParamDef | undefined {
  if (!path.startsWith("fx.")) return undefined;
  const [, fxId, key] = path.split(".");
  const fx = layer.effects.find((e) => e.id === fxId);
  return fx ? effectDef(fx.type)?.params.find((p) => p.key === key) : undefined;
}

function propName(layer: Layer, path: string): string {
  return PROP_LABELS[path] ?? paramDef(layer, path)?.label ?? path;
}

type Drag =
  | { kind: "cti" }
  | { kind: "bar"; ids: string[]; startX: number; lastDelta: number; origin: Map<string, number> }
  | { kind: "trim"; id: string; edge: "in" | "out" }
  | { kind: "keys"; startX: number; applied: number }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: "work"; part: "start" | "end" | "both"; startX: number; orig: [number, number] }
  | { kind: "reorder"; id: string; y: number; target: number }
  | { kind: "handle"; sel: KeySelection; side: "in" | "out"; t0: number; t1: number };

export function TimelinePanel() {
  const comp = useProject((s) => activeComp(s.project));
  const currentTime = useProject((s) => s.currentTime);
  const selectedLayerIds = useProject((s) => s.selectedLayerIds);
  const selectedKeys = useProject((s) => s.selectedKeys);
  const ui = useUi();
  const [trackRef, trackSize] = useElementSize<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(300);
  const [viewStart, setViewStart] = useState(0);
  const [graphProp, setGraphProp] = useState<{ layerId: string; path: string } | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const setDrag = (d: Drag | null): void => {
    dragRef.current = d;
    setDragState(d);
  };

  const rows = useMemo(() => (comp ? buildRows(comp, ui.expanded, ui.revealPaths) : []), [comp, ui.expanded, ui.revealPaths]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!comp) return <Empty>No composition open.</Empty>;

  const trackW = Math.max(100, trackSize.w);
  const pps = (trackW / comp.duration) * ui.timelineZoom; // pixels per second
  const visibleDur = trackW / pps;
  const vStart = Math.min(Math.max(0, viewStart), Math.max(0, comp.duration - visibleDur));
  const tx = (t: number): number => (t - vStart) * pps;
  const xt = (x: number): number => x / pps + vStart;
  const frame = 1 / comp.fps;

  // snapping targets: CTI, layer edges, keyframes, markers, work area
  const snapTargets = (): number[] => {
    const out = [currentTime, 0, comp.duration, comp.workArea[0], comp.workArea[1]];
    for (const l of comp.layers) {
      out.push(l.inPoint, l.outPoint);
      for (const p of [...TRANSFORM_PATHS, "shape.size"]) for (const k of getProp(l, p)?.keyframes ?? []) out.push(k.time + l.start);
    }
    for (const m of comp.markers) out.push(m.time);
    return out;
  };
  const snap = (t: number, shift: boolean, exclude: number[] = []): number => {
    const on = ui.snapping !== shift;
    if (!on) return snapToFrame(t, comp.fps);
    let best = t;
    let bd = 8 / pps;
    for (const c of snapTargets()) {
      if (exclude.some((e) => Math.abs(e - c) < 1e-6)) continue;
      const d = Math.abs(c - t);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return snapToFrame(best, comp.fps);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 5);
  const visibleRows = rows.slice(first, last);
  const isKeySelected = (layerId: string, path: string, keyId: string): boolean => selectedKeys.some((k) => k.layerId === layerId && k.path === path && k.keyId === keyId);

  // ---------- pointer interaction on the track area ----------
  const trackX = (e: { clientX: number }): number => e.clientX - (trackRef.current?.getBoundingClientRect().left ?? 0);
  const trackY = (e: { clientY: number }): number => e.clientY - (scrollRef.current?.getBoundingClientRect().top ?? 0) + scrollTop;

  const onMove = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    const s = useProject.getState();
    const x = trackX(e);
    switch (d.kind) {
      case "cti":
        s.setTime(snap(xt(x), e.shiftKey));
        break;
      case "bar": {
        const raw = (x - d.startX) / pps;
        const first0 = d.origin.get(d.ids[0]) ?? 0;
        const snapped = snap(first0 + raw, e.shiftKey, [first0]) - first0;
        const delta = snapToFrame(snapped, comp.fps);
        if (Math.abs(delta - d.lastDelta) > 1e-9) {
          cmd.shiftLayers(d.ids, delta - d.lastDelta);
          setDrag({ ...d, lastDelta: delta });
        }
        break;
      }
      case "trim":
        cmd.trimLayer(d.id, d.edge, snap(xt(x), e.shiftKey));
        break;
      case "keys": {
        const delta = snapToFrame((x - d.startX) / pps, comp.fps);
        if (Math.abs(delta - d.applied) > 1e-9) {
          cmd.moveSelectedKeys(delta - d.applied);
          setDrag({ ...d, applied: delta });
        }
        break;
      }
      case "marquee":
        setDrag({ ...d, x1: x, y1: trackY(e) });
        break;
      case "work": {
        const dt = (x - d.startX) / pps;
        if (d.part === "start") cmd.setWorkArea(snap(d.orig[0] + dt, e.shiftKey), d.orig[1]);
        else if (d.part === "end") cmd.setWorkArea(d.orig[0], snap(d.orig[1] + dt, e.shiftKey));
        else {
          const len = d.orig[1] - d.orig[0];
          const a = Math.max(0, Math.min(comp.duration - len, snapToFrame(d.orig[0] + dt, comp.fps)));
          cmd.setWorkArea(a, a + len);
        }
        break;
      }
      case "reorder": {
        const y = trackYLeft(e);
        const target = Math.max(0, Math.min(comp.layers.length, Math.round(y / ROW_H)));
        setDrag({ ...d, y, target });
        break;
      }
      case "handle": {
        const t = xt(x);
        const span = Math.max(1e-6, d.t1 - d.t0);
        const inf = d.side === "out" ? (t - d.t0) / span : (d.t1 - t) / span;
        cmd.setKeyInfluence(d.sel, d.side, Math.max(0.01, Math.min(1, inf)));
        break;
      }
    }
  };

  const trackYLeft = (e: { clientY: number }): number => {
    // index of layer rows only (reorder works on layer order)
    const y = e.clientY - (scrollRef.current?.getBoundingClientRect().top ?? 0) + scrollTop;
    const rowIdx = Math.floor(y / ROW_H);
    let layerIdx = 0;
    for (let i = 0; i < Math.min(rowIdx, rows.length); i++) if (rows[i].type === "layer") layerIdx++;
    return layerIdx * ROW_H;
  };

  const onUp = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    useProject.getState().endGesture();
    if (d?.kind === "marquee") {
      const x0 = Math.min(d.x0, d.x1);
      const x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      const y1 = Math.max(d.y0, d.y1);
      const picked: KeySelection[] = d.additive ? [...useProject.getState().selectedKeys] : [];
      rows.forEach((r, i) => {
        if (r.type !== "prop") return;
        const cy = i * ROW_H + ROW_H / 2;
        if (cy < y0 || cy > y1) return;
        for (const k of getProp(r.layer, r.path)?.keyframes ?? []) {
          const kx = tx(k.time + r.layer.start);
          if (kx >= x0 && kx <= x1 && !picked.some((p) => p.keyId === k.id)) picked.push({ layerId: r.layer.id, path: r.path, keyId: k.id });
        }
      });
      useProject.getState().selectKeys(picked);
    }
    if (d?.kind === "reorder") {
      const from = comp.layers.findIndex((l) => l.id === d.id);
      const to = d.target > from ? d.target - 1 : d.target;
      if (to !== from) cmd.reorderLayer(d.id, to);
    }
    setDrag(null);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const begin = (e: React.PointerEvent, d: Drag, gesture?: string): void => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (gesture) useProject.getState().beginGesture(gesture);
    stop();
    setDrag(d);
  };

  const onKeyDown = (layer: Layer, path: string, k: Keyframe, e: React.PointerEvent): void => {
    const s = useProject.getState();
    const me: KeySelection = { layerId: layer.id, path, keyId: k.id };
    let next = s.selectedKeys;
    const selected = isKeySelected(layer.id, path, k.id);
    if (e.shiftKey || e.ctrlKey) next = selected ? next.filter((x) => x.keyId !== k.id) : [...next, me];
    else if (!selected) next = [me];
    s.selectKeys(next);
    s.selectLayers([layer.id]);
    setGraphProp({ layerId: layer.id, path });
    if (e.button === 2) return;
    begin(e, { kind: "keys", startX: trackX(e), applied: 0 }, "keys");
  };

  const onTrackBgDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    const x = trackX(e);
    const y = trackY(e);
    begin(e, { kind: "marquee", x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey });
    if (!e.shiftKey) useProject.getState().selectKeys([]);
  };

  const onWheel = (e: React.WheelEvent): void => {
    if (e.ctrlKey || e.altKey) {
      const mouseT = xt(trackX(e));
      const z = Math.max(1, Math.min(200, ui.timelineZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      ui.set({ timelineZoom: z });
      const newPps = (trackW / comp.duration) * z;
      setViewStart(mouseT - trackX(e) / newPps);
    } else if (e.shiftKey) {
      setViewStart(vStart + (e.deltaY / pps) * 0.5);
    }
  };

  const layerColor = (l: Layer): string => LABEL_COLORS[l.label] ?? "#777";
  const cached = ui.cachedFrames;
  const ctiX = tx(currentTime);

  return (
    <div className="panel-root" onPointerMove={onMove} onPointerUp={onUp} onContextMenu={(e) => e.preventDefault()}>
      {/* toolbar */}
      <div className="panel-bar">
        <ScrubNumber label="Current time" value={currentTime * comp.fps} step={1} min={0} max={comp.duration * comp.fps - 1} precision={0} width={90} onChange={(f) => useProject.getState().setTime(f / comp.fps)} />
        <span className="mono text-[13px] text-[#4fa3ff] -ml-1">{formatTimecode(currentTime, comp.fps)}</span>
        <span className="text-muted ml-2">{comp.name}</span>
        <span className="flex-1" />
        <button type="button" className="icon-btn" data-on={ui.snapping} title="Snapping (hold Shift while dragging to invert)" aria-label="Snapping" onClick={() => ui.set({ snapping: !ui.snapping })}>
          <Magnet size={14} />
        </button>
        <button type="button" className="icon-btn" data-on={ui.graphEditor} title="Graph Editor (Shift+F3)" aria-label="Graph editor" onClick={() => ui.set({ graphEditor: !ui.graphEditor })}>
          <LineChart size={14} />
        </button>
        {ui.graphEditor && (
          <div className="flex text-[11px]">
            {(["value", "speed"] as const).map((m) => (
              <button key={m} type="button" className="btn" style={{ height: 20, padding: "0 8px", background: ui.graphMode === m ? "var(--accent)" : undefined }} onClick={() => ui.set({ graphMode: m })}>
                {m === "value" ? "Value" : "Speed"}
              </button>
            ))}
          </div>
        )}
        <input type="range" aria-label="Timeline zoom" min={0} max={100} value={Math.round(Math.log(ui.timelineZoom) / Math.log(200) * 100)} onChange={(e) => ui.set({ timelineZoom: Math.pow(200, Number(e.target.value) / 100) })} style={{ width: 120, accentColor: "var(--accent)" }} />
      </div>

      <div className="flex flex-none">
        {/* left: layer outline */}
        <div className="flex-none flex flex-col border-r border-line" style={{ width: LEFT_W }}>
          <div className="flex items-center text-[11px] text-muted border-b border-line px-2 gap-1" style={{ height: RULER_H }}>
            <span className="w-[66px]">Switches</span>
            <span className="w-[22px]">#</span>
            <span className="flex-1">Layer Name</span>
            <span className="w-[92px]">Parent</span>
          </div>
        </div>
        {/* right: ruler */}
        <div ref={trackRef} className="flex-1 min-w-0 relative border-b border-line" style={{ height: RULER_H }} onWheel={onWheel}>
          <Ruler comp={comp} pps={pps} vStart={vStart} width={trackW} />
          {/* work area */}
          <div className="absolute" style={{ left: tx(comp.workArea[0]), width: Math.max(4, tx(comp.workArea[1]) - tx(comp.workArea[0])), top: RULER_H - 12, height: 6, background: "#5b6b8a" }} onPointerDown={(e) => begin(e, { kind: "work", part: "both", startX: trackX(e), orig: comp.workArea }, "work")}>
            <span className="absolute left-0 top-[-2px] w-[6px] h-[10px] bg-[#9fb4dd] cursor-ew-resize" onPointerDown={(e) => begin(e, { kind: "work", part: "start", startX: trackX(e), orig: comp.workArea }, "work")} />
            <span className="absolute right-0 top-[-2px] w-[6px] h-[10px] bg-[#9fb4dd] cursor-ew-resize" onPointerDown={(e) => begin(e, { kind: "work", part: "end", startX: trackX(e), orig: comp.workArea }, "work")} />
          </div>
          {/* RAM cache bar */}
          <CacheBar cached={cached} fps={comp.fps} tx={tx} y={RULER_H - 4} />
          {comp.markers.map((m) => (
            <span key={m.id} title={m.label || "Marker"} className="absolute w-[8px] h-[8px] rotate-45 bg-[#e0b851]" style={{ left: tx(m.time) - 4, top: 3 }} />
          ))}
          <div className="absolute inset-x-0 top-0" style={{ height: RULER_H - 12 }} onPointerDown={(e) => {
            begin(e, { kind: "cti" });
            useProject.getState().setTime(snap(xt(trackX(e)), e.shiftKey));
          }} />
          <div className="absolute pointer-events-none" style={{ left: ctiX - 6, top: 0, width: 12, height: 12, background: "#4fa3ff", clipPath: "polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)" }} />
        </div>
      </div>

      {/* rows (shared vertical scroll) */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative" onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} onWheel={onWheel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const mediaId = e.dataTransfer.getData("application/x-minifx-media");
          const m = useProject.getState().project.media.find((x) => x.id === mediaId);
          if (m) cmd.addMediaLayer(m, Math.max(0, snapToFrame(xt(trackX(e)), comp.fps)));
        }}
      >
        <div className="relative" style={{ height: Math.max(rows.length * ROW_H, 40) }}>
          {visibleRows.map((r, i) => {
            const rowIndex = first + i;
            const top = rowIndex * ROW_H;
            const layerSelected = selectedLayerIds.includes(r.layer.id);
            return (
              <div key={`${r.layer.id}-${r.type}-${r.type === "prop" ? r.path : r.type === "group" ? r.label : ""}`} className="absolute inset-x-0 flex border-b border-[#262626]" style={{ top, height: ROW_H, background: layerSelected && r.type === "layer" ? "#2b3340" : r.type === "layer" ? "#1f1f1f" : "#1b1b1b" }}>
                <div className="flex-none flex items-center gap-1 pr-1 border-r border-line overflow-hidden" style={{ width: LEFT_W }}>
                  {r.type === "layer" ? (
                    <LayerHeader
                      layer={r.layer}
                      index={r.index}
                      comp={comp}
                      expanded={!!ui.expanded[r.layer.id]}
                      selected={layerSelected}
                      renaming={renaming === r.layer.id}
                      setRenaming={setRenaming}
                      onReorderStart={(e) => begin(e, { kind: "reorder", id: r.layer.id, y: trackYLeft(e), target: r.index })}
                    />
                  ) : r.type === "group" ? (
                    <span className="text-[#bdbdbd] truncate" style={{ paddingLeft: 30 + r.depth * 14 }}>{r.label}</span>
                  ) : (
                    <PropHeader row={r} time={currentTime} onFocus={() => setGraphProp({ layerId: r.layer.id, path: r.path })} focused={graphProp?.layerId === r.layer.id && graphProp.path === r.path} />
                  )}
                </div>
                <div className="flex-1 min-w-0 relative overflow-hidden" onPointerDown={onTrackBgDown}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const fx = e.dataTransfer.getData("application/x-minifx-effect");
                    if (fx) {
                      e.stopPropagation();
                      cmd.addEffect([r.layer.id], fx);
                    }
                  }}
                >
                  {!ui.graphEditor && r.type === "layer" && (
                    <div
                      className="absolute rounded-[2px]"
                      style={{ left: tx(r.layer.inPoint), width: Math.max(2, tx(r.layer.outPoint) - tx(r.layer.inPoint)), top: 3, bottom: 3, background: layerColor(r.layer), opacity: r.layer.visible ? (layerSelected ? 0.95 : 0.65) : 0.3, outline: layerSelected ? "1px solid #fff" : undefined, cursor: r.layer.locked ? "not-allowed" : "grab" }}
                      onPointerDown={(e) => {
                        if (r.layer.locked) return;
                        const s = useProject.getState();
                        const ids = e.shiftKey ? [...new Set([...s.selectedLayerIds, r.layer.id])] : s.selectedLayerIds.includes(r.layer.id) ? s.selectedLayerIds : [r.layer.id];
                        s.selectLayers(ids);
                        const origin = new Map(comp.layers.filter((l) => ids.includes(l.id)).map((l) => [l.id, l.inPoint]));
                        begin(e, { kind: "bar", ids: [r.layer.id, ...ids.filter((x) => x !== r.layer.id)], startX: trackX(e), lastDelta: 0, origin }, "bar");
                      }}
                    >
                      <span className="absolute left-0 top-0 bottom-0 w-[6px] cursor-ew-resize bg-white/20" onPointerDown={(e) => begin(e, { kind: "trim", id: r.layer.id, edge: "in" }, "trim")} />
                      <span className="absolute right-0 top-0 bottom-0 w-[6px] cursor-ew-resize bg-white/20" onPointerDown={(e) => begin(e, { kind: "trim", id: r.layer.id, edge: "out" }, "trim")} />
                      <span className="absolute left-2 top-0 text-[10px] text-black/70 truncate pointer-events-none" style={{ right: 8, lineHeight: `${ROW_H - 6}px` }}>{r.layer.name}</span>
                    </div>
                  )}
                  {!ui.graphEditor && r.type === "layer" && !ui.expanded[r.layer.id] && <CollapsedKeys layer={r.layer} tx={tx} />}
                  {!ui.graphEditor && r.type === "prop" &&
                    (getProp(r.layer, r.path)?.keyframes ?? []).map((k) => {
                      const sel = isKeySelected(r.layer.id, r.path, k.id);
                      return (
                        <button
                          key={k.id}
                          type="button"
                          aria-label={`Keyframe at ${formatTimecode(k.time + r.layer.start, comp.fps)}`}
                          className="absolute border-0 p-0"
                          style={{ left: tx(k.time + r.layer.start) - 5, top: ROW_H / 2 - 5, width: 10, height: 10, transform: k.interp === "hold" ? undefined : "rotate(45deg)", borderRadius: k.interp === "bezier" ? 5 : 1, background: sel ? "#4fa3ff" : "var(--key)", outline: sel ? "1px solid #fff" : "1px solid #000" }}
                          onPointerDown={(e) => onKeyDown(r.layer, r.path, k, e)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY });
                          }}
                          onDoubleClick={() => useProject.getState().setTime(k.time + r.layer.start)}
                        />
                      );
                    })}
                </div>
              </div>
            );
          })}
          {/* reorder indicator */}
          {drag?.kind === "reorder" && <div className="absolute h-[2px] bg-accent pointer-events-none" style={{ top: rowTopForLayerIndex(rows, drag.target) - 1, left: 0, width: LEFT_W }} />}
          {/* marquee */}
          {drag?.kind === "marquee" && (
            <div className="absolute border border-accent bg-accent/10 pointer-events-none" style={{ left: LEFT_W + Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />
          )}
        </div>
        {ui.graphEditor && (
          <div className="absolute top-0 bottom-0 right-0" style={{ left: LEFT_W, top: scrollTop }}>
            <GraphEditor comp={comp} prop={graphProp} tx={tx} xt={xt} width={trackW} height={viewH} mode={ui.graphMode} selectedKeys={selectedKeys} onHandleDown={(e, sel, side, t0, t1) => begin(e, { kind: "handle", sel, side, t0, t1 }, "influence")} onKeyDown={onKeyDown} />
          </div>
        )}
        {/* CTI line */}
        <div className="absolute pointer-events-none bg-[#4fa3ff]" style={{ left: LEFT_W + ctiX, width: 1, top: scrollTop, height: viewH }} />
      </div>

      {menu && (
        <div className="fixed inset-0 z-50" onPointerDown={() => setMenu(null)}>
          <div className="menu-pop" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            {(
              [
                ["Linear", () => cmd.setSelectedInterp("linear")],
                ["Bezier", () => cmd.setSelectedInterp("bezier")],
                ["Hold", () => cmd.setSelectedInterp("hold")],
                ["Easy Ease (F9)", () => cmd.easyEaseSelected("both")],
                ["Easy Ease In", () => cmd.easyEaseSelected("in")],
                ["Easy Ease Out", () => cmd.easyEaseSelected("out")],
                ["Copy", () => cmd.copySelectedKeys()],
                ["Delete", () => cmd.deleteSelectedKeys()],
              ] as [string, () => void][]
            ).map(([label, fn]) => (
              <button key={label} type="button" className="menu-item" onClick={() => { fn(); setMenu(null); }}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="hidden">{frame}</div>
    </div>
  );
}

function rowTopForLayerIndex(rows: Row[], target: number): number {
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "layer") {
      if (count === target) return i * ROW_H;
      count++;
    }
  }
  return rows.length * ROW_H;
}

function Ruler({ comp, pps, vStart, width }: { comp: Composition; pps: number; vStart: number; width: number }) {
  const steps = [1 / comp.fps, 2 / comp.fps, 5 / comp.fps, 10 / comp.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const major = steps.find((s) => s * pps >= 70) ?? 300;
  const minor = major / 5;
  const ticks: JSX.Element[] = [];
  const start = Math.floor(vStart / minor) * minor;
  for (let i = 0; i < 600; i++) {
    const t = Math.round((start + i * minor) * 10000) / 10000;
    if (t > vStart + width / pps + minor) break;
    const x = (t - vStart) * pps;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push(<span key={t.toFixed(4)} className="absolute bg-[#555]" style={{ left: x, top: isMajor ? 10 : 16, width: 1, height: isMajor ? 10 : 4 }} />);
    if (isMajor) {
      ticks.push(
        <span key={`l${t.toFixed(4)}`} className="absolute mono text-[10px] text-muted" style={{ left: x + 3, top: 0 }}>
          {major < 1 ? `${Math.floor(t)}:${String(Math.round((t % 1) * comp.fps)).padStart(2, "0")}f` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`}
        </span>,
      );
    }
  }
  return <div className="absolute inset-0 overflow-hidden pointer-events-none">{ticks}</div>;
}

function CacheBar({ cached, fps, tx, y }: { cached: Set<number>; fps: number; tx: (t: number) => number; y: number }) {
  if (!cached.size) return null;
  const frames = [...cached].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (const f of frames) {
    const lastSpan = spans[spans.length - 1];
    if (lastSpan && f === lastSpan[1] + 1) lastSpan[1] = f;
    else spans.push([f, f]);
  }
  return (
    <>
      {spans.map(([a, b]) => (
        <span key={a} className="absolute bg-[#46c08a]" style={{ left: tx(a / fps), width: Math.max(1, tx((b + 1) / fps) - tx(a / fps)), top: y, height: 3 }} />
      ))}
    </>
  );
}

function CollapsedKeys({ layer, tx }: { layer: Layer; tx: (t: number) => number }) {
  const times = new Set<number>();
  for (const p of [...TRANSFORM_PATHS, "shape.size"]) for (const k of getProp(layer, p)?.keyframes ?? []) times.add(Math.round((k.time + layer.start) * 1000) / 1000);
  for (const fx of layer.effects) for (const prop of Object.values(fx.params)) for (const k of prop.keyframes) times.add(Math.round((k.time + layer.start) * 1000) / 1000);
  return (
    <>
      {[...times].map((t) => (
        <span key={t} className="absolute pointer-events-none" style={{ left: tx(t) - 3, top: ROW_H - 8, width: 6, height: 6, transform: "rotate(45deg)", background: "#bbb" }} />
      ))}
    </>
  );
}

function LayerHeader(props: { layer: Layer; index: number; comp: Composition; expanded: boolean; selected: boolean; renaming: boolean; setRenaming: (id: string | null) => void; onReorderStart: (e: React.PointerEvent) => void }) {
  const { layer, index, comp } = props;
  const s = useProject.getState;
  const isAudio = layer.kind === "audio" || layer.kind === "video";
  return (
    <>
      <button type="button" className="icon-btn" style={{ width: 18 }} aria-label={layer.visible ? "Hide layer" : "Show layer"} onClick={() => cmd.toggleLayerFlag(layer.id, "visible")}>
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      {isAudio ? (
        <button type="button" className="icon-btn" style={{ width: 18 }} aria-label="Toggle audio" onClick={() => cmd.toggleLayerFlag(layer.id, "audioEnabled")}>
          {layer.audioEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
        </button>
      ) : (
        <span style={{ width: 18 }} />
      )}
      <button type="button" className="icon-btn" style={{ width: 18 }} aria-label="Solo" aria-pressed={layer.solo} onClick={() => cmd.toggleLayerFlag(layer.id, "solo")}>
        {layer.solo ? <CircleDot size={12} color="var(--accent)" /> : <Circle size={12} />}
      </button>
      <button type="button" className="icon-btn" style={{ width: 18 }} aria-label={layer.locked ? "Unlock" : "Lock"} onClick={() => cmd.toggleLayerFlag(layer.id, "locked")}>
        {layer.locked ? <Lock size={12} /> : <Unlock size={12} color="#555" />}
      </button>
      <button type="button" aria-label="Label color" className="w-[10px] h-[10px] rounded-sm border-0 flex-none cursor-pointer" style={{ background: LABEL_COLORS[layer.label] }} onClick={() => cmd.setLabel(layer.id, (layer.label % (LABEL_COLORS.length - 1)) + 1)} />
      <span className="mono text-muted w-[18px] text-right flex-none cursor-grab" onPointerDown={props.onReorderStart} title="Drag to reorder">{index + 1}</span>
      <button type="button" className="icon-btn" style={{ width: 16 }} aria-label={props.expanded ? "Collapse" : "Expand"} onClick={() => useUiToggle(layer.id)}>
        {props.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {props.renaming ? (
        <input
          autoFocus
          aria-label="Layer name"
          className="field flex-1 min-w-0"
          defaultValue={layer.name}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") props.setRenaming(null);
          }}
          onBlur={(e) => {
            if (e.target.value.trim()) cmd.renameLayer(layer.id, e.target.value.trim());
            props.setRenaming(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="flex-1 min-w-0 truncate text-left bg-transparent border-0 p-0 cursor-default"
          style={{ color: props.selected ? "#fff" : "#d6d6d6" }}
          onPointerDown={(e) => {
            const cur = s().selectedLayerIds;
            if (e.shiftKey || e.ctrlKey) s().selectLayers(cur.includes(layer.id) ? cur.filter((x) => x !== layer.id) : [...cur, layer.id]);
            else s().selectLayers([layer.id]);
          }}
          onDoubleClick={() => props.setRenaming(layer.id)}
          title={`${layer.kind} layer · double-click to rename`}
        >
          {layer.name}
        </button>
      )}
      <select
        aria-label="Parent"
        className="field flex-none"
        style={{ width: 92, height: 18, padding: "0 2px", fontSize: 11 }}
        value={layer.parentId ?? ""}
        onChange={(e) => {
          if (!cmd.setParent(layer.id, e.target.value || null)) alert("That parent would create a loop.");
        }}
      >
        <option value="">None</option>
        {comp.layers
          .filter((l) => l.id !== layer.id)
          .map((l) => (
            <option key={l.id} value={l.id}>
              {comp.layers.indexOf(l) + 1}. {l.name}
            </option>
          ))}
      </select>
    </>
  );
}

function useUiToggle(id: string): void {
  const u = useUi.getState();
  u.toggleExpanded(id);
  if (u.revealPaths[id]) u.set({ revealPaths: { ...u.revealPaths, [id]: undefined } });
}

function PropHeader({ row, time, onFocus, focused }: { row: Extract<Row, { type: "prop" }>; time: number; onFocus: () => void; focused: boolean }) {
  const { layer, path, label } = row;
  const prop = getProp(layer, path);
  if (!prop) return null;
  const lt = time - layer.start;
  const value = valueAt(prop, lt);
  const animated = prop.keyframes.length > 0;
  const atKey = prop.keyframes.some((k) => Math.abs(k.time - lt) < 1e-3);
  const keysSorted = [...prop.keyframes].sort((a, b) => a.time - b.time);
  const goto = (dir: -1 | 1): void => {
    const k = dir < 0 ? [...keysSorted].reverse().find((x) => x.time < lt - 1e-4) : keysSorted.find((x) => x.time > lt + 1e-4);
    if (k) useProject.getState().setTime(k.time + layer.start);
  };
  return (
    <div className="flex items-center gap-1 w-full min-w-0" style={{ paddingLeft: 14 + row.depth * 14 }} onPointerDown={onFocus}>
      <Stopwatch on={animated} label={label} onClick={() => cmd.toggleStopwatch(layer.id, path)} />
      <span className="truncate flex-none w-[104px]" style={{ color: focused ? "#8ec5ff" : "#cfcfcf" }}>{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <ValueEditor layer={layer} path={path} value={value} def={row.def} />
      </div>
      {animated && (
        <span className="flex items-center flex-none">
          <button type="button" className="icon-btn" style={{ width: 14 }} aria-label="Previous keyframe" onClick={() => goto(-1)}><ChevronLeft size={11} /></button>
          <button type="button" className="icon-btn" style={{ width: 14 }} aria-label={atKey ? "Remove keyframe" : "Add keyframe"} onClick={() => (atKey ? cmd.removeKeyframeAt(layer.id, path, time) : cmd.addKeyframeAtTime(layer.id, path))}>
            <Diamond size={10} fill={atKey ? "var(--key)" : "none"} color="var(--key)" />
          </button>
          <button type="button" className="icon-btn" style={{ width: 14 }} aria-label="Next keyframe" onClick={() => goto(1)}><Next size={11} /></button>
        </span>
      )}
    </div>
  );
}

export function ValueEditor({ layer, path, value, def }: { layer: Layer; path: string; value: ParamValue; def?: ParamDef }) {
  const set = (v: ParamValue): void => cmd.setPropValue(layer.id, path, v, "Change Value");
  const g = `${layer.id}:${path}`;
  if (def?.kind === "color" && typeof value === "string") return <ColorField label={def.label} value={value} onChange={set} />;
  if (def?.kind === "checkbox") return <input type="checkbox" aria-label={def.label} checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />;
  if (isVec2(value)) {
    const linked = path === "transform.scale";
    const v = value as Vec2;
    return (
      <>
        <ScrubNumber label={`${path} x`} gestureKey={g} value={v[0]} step={path === "transform.scale" ? 0.5 : 1} onChange={(x) => set(linked && v[0] !== 0 ? [x, (v[1] * x) / v[0]] : [x, v[1]])} suffix={path === "transform.scale" ? "%" : ""} />
        <ScrubNumber label={`${path} y`} gestureKey={g} value={v[1]} step={path === "transform.scale" ? 0.5 : 1} onChange={(y) => set(linked && v[1] !== 0 ? [(v[0] * y) / v[1], y] : [v[0], y])} suffix={path === "transform.scale" ? "%" : ""} />
      </>
    );
  }
  if (typeof value === "number") {
    const suffix = path === "transform.rotation" ? "°" : path === "transform.opacity" ? "%" : "";
    return <ScrubNumber label={path} gestureKey={g} value={value} step={def?.step ?? (path === "transform.opacity" ? 1 : 0.5)} min={def?.min ?? (path === "transform.opacity" ? 0 : -Infinity)} max={def?.max ?? (path === "transform.opacity" ? 100 : Infinity)} suffix={suffix} onChange={set} />;
  }
  return <span className="text-muted">{String(value)}</span>;
}

function GraphEditor(props: {
  comp: Composition;
  prop: { layerId: string; path: string } | null;
  tx: (t: number) => number;
  xt: (x: number) => number;
  width: number;
  height: number;
  mode: "value" | "speed";
  selectedKeys: KeySelection[];
  onHandleDown: (e: React.PointerEvent, sel: KeySelection, side: "in" | "out", t0: number, t1: number) => void;
  onKeyDown: (layer: Layer, path: string, k: Keyframe, e: React.PointerEvent) => void;
}) {
  const { comp, prop, tx, width, height, mode } = props;
  const layer = prop ? comp.layers.find((l) => l.id === prop.layerId) : undefined;
  const ap: AnimProp | undefined = layer && prop ? getProp(layer, prop.path) : undefined;
  if (!layer || !ap || !prop) {
    return <div className="w-full h-full flex items-center justify-center text-muted bg-[#161616]">Click a property name (or a keyframe) to show its curve.</div>;
  }
  const keys = [...ap.keyframes].sort((a, b) => a.time - b.time);
  const t0 = layer.inPoint;
  const t1 = layer.outPoint;
  const samples = 240;
  const channels: { color: string; pick: (v: ParamValue) => number }[] =
    mode === "speed"
      ? [{ color: "#e6e6e6", pick: () => 0 }]
      : isVec2(ap.value)
        ? [
            { color: "#e5534b", pick: (v) => (isVec2(v) ? v[0] : 0) },
            { color: "#46c08a", pick: (v) => (isVec2(v) ? v[1] : 0) },
          ]
        : [{ color: "#4fa3ff", pick: (v) => scalarOf(v) }];
  const series = channels.map((ch) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const t = t0 + ((t1 - t0) * i) / samples;
      const lt = t - layer.start;
      pts.push([t, mode === "speed" ? speedAt(ap, lt) : ch.pick(valueAt(ap, lt))]);
    }
    return { color: ch.color, pts, pick: ch.pick };
  });
  const all = series.flatMap((s) => s.pts.map((p) => p[1]));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const h = Math.max(80, height);
  const vy = (v: number): number => h - ((v - lo) / (hi - lo)) * h;
  const path = (pts: [number, number][]): string => pts.map((p, i) => `${i ? "L" : "M"}${tx(p[0]).toFixed(1)},${vy(p[1]).toFixed(1)}`).join(" ");
  const grid: JSX.Element[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    grid.push(<line key={`g${i}`} x1={0} x2={width} y1={vy(v)} y2={vy(v)} stroke="#262626" />);
    grid.push(<text key={`t${i}`} x={4} y={vy(v) - 3} fill="#777" fontSize={10} fontFamily="JetBrains Mono">{v.toFixed(Math.abs(hi - lo) < 10 ? 2 : 0)}</text>);
  }
  return (
    <svg width={width} height={h} className="block bg-[#161616]" role="img" aria-label={`${mode} graph of ${prop.path}`}>
      {grid}
      {series.map((s, i) => (
        <path key={i} d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={1.6} />
      ))}
      {mode === "value" &&
        keys.map((k, i) => {
          const next = keys[i + 1];
          const prev = keys[i - 1];
          const t = k.time + layer.start;
          const sel: KeySelection = { layerId: layer.id, path: prop.path, keyId: k.id };
          const isSel = props.selectedKeys.some((x) => x.keyId === k.id);
          return (
            <g key={k.id}>
              {series.map((s, si) => {
                const y = vy(s.pick(k.value));
                const handles: JSX.Element[] = [];
                if (isSel && next && k.interp === "bezier") {
                  const hx = tx(t + (next.time - k.time) * Math.max(0.01, k.easeOut));
                  handles.push(<line key="lo" x1={tx(t)} y1={y} x2={hx} y2={y} stroke="#f5b13d" />, <circle key="co" cx={hx} cy={y} r={4} fill="#f5b13d" style={{ cursor: "ew-resize" }} onPointerDown={(e) => props.onHandleDown(e, sel, "out", t, next.time + layer.start)} />);
                }
                if (isSel && prev && (prev.interp === "bezier" || k.easeIn > 0)) {
                  const hx = tx(t - (k.time - prev.time) * Math.max(0.01, k.easeIn));
                  handles.push(<line key="li" x1={tx(t)} y1={y} x2={hx} y2={y} stroke="#f5b13d" />, <circle key="ci" cx={hx} cy={y} r={4} fill="#f5b13d" style={{ cursor: "ew-resize" }} onPointerDown={(e) => props.onHandleDown(e, sel, "in", prev.time + layer.start, t)} />);
                }
                return (
                  <g key={si}>
                    {handles}
                    <rect x={tx(t) - 4} y={y - 4} width={8} height={8} fill={isSel ? "#4fa3ff" : "#f5b13d"} stroke="#000" style={{ cursor: "pointer" }} onPointerDown={(e) => props.onKeyDown(layer, prop.path, k, e)} />
                  </g>
                );
              })}
            </g>
          );
        })}
    </svg>
  );
}
