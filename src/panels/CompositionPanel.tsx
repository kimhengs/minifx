import { useEffect, useRef, useState } from "react";
import { Graphics } from "pixi.js";
import { Circle, Hand, Hexagon, MousePointer2, PenTool, Square, Type, Crosshair, ScanLine, Grid3x3, Frame } from "lucide-react";
import * as cmd from "../commands";
import { apply, invert, localMatrix, resolveTransform, worldMatrix, type Mat } from "../engine/evaluate";
import { formatTimecode } from "../engine/factory";
import { CompRenderer } from "../engine/renderer";
import type { Composition, Layer, Vec2 } from "../engine/types";
import { activeComp, useProject } from "../store/projectStore";
import { useUi, type Tool } from "../store/uiStore";
import { perf } from "../lib/perf";
import { keyState } from "../app/keyState";
import { frameCache, registerPrerender } from "../app/ramPreview";
import { Empty, Select } from "../app/ui";

type Drag =
  | { kind: "pan"; sx: number; sy: number; px: number; py: number }
  | { kind: "move"; sx: number; sy: number; starts: Map<string, Vec2>; inv: Map<string, Mat> }
  | { kind: "scale"; id: string; startScale: Vec2; startDist: number; center: Vec2; uniform: boolean }
  | { kind: "rotate"; id: string; startRot: number; startAngle: number; center: Vec2 }
  | { kind: "anchor"; id: string; sx: number; sy: number; anchor: Vec2; position: Vec2 }
  | { kind: "draw"; tool: Tool; a: Vec2; b: Vec2 };

const TOOLS: { tool: Tool; label: string; icon: JSX.Element }[] = [
  { tool: "select", label: "Selection (V)", icon: <MousePointer2 size={15} /> },
  { tool: "hand", label: "Hand (H)", icon: <Hand size={15} /> },
  { tool: "anchor", label: "Anchor Point (Y)", icon: <Crosshair size={15} /> },
  { tool: "rect", label: "Rectangle (Q)", icon: <Square size={15} /> },
  { tool: "ellipse", label: "Ellipse (Q)", icon: <Circle size={15} /> },
  { tool: "polygon", label: "Polygon (Q)", icon: <Hexagon size={15} /> },
  { tool: "pen", label: "Pen (G)", icon: <PenTool size={15} /> },
  { tool: "text", label: "Type (Ctrl+T)", icon: <Type size={15} /> },
  { tool: "maskRect", label: "Rectangle Mask (M)", icon: <ScanLine size={15} /> },
  { tool: "maskEllipse", label: "Ellipse Mask (M)", icon: <Circle size={15} strokeDasharray="3 2" /> },
];

const HANDLE = 7;

export function CompositionPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const cacheCanvasRef = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<CompRenderer | null>(null);
  const viewRef = useRef<{ scale: number; ox: number; oy: number }>({ scale: 0.5, ox: 0, oy: 0 });
  const dragRef = useRef<Drag | null>(null);
  const [ready, setReady] = useState(false);
  const [textEdit, setTextEdit] = useState<{ id: string; x: number; y: number; value: string } | null>(null);
  const comp = useProject((s) => activeComp(s.project));
  const currentTime = useProject((s) => s.currentTime);
  const ui = useUi();

  // ---------- renderer lifecycle ----------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const r = new CompRenderer(false);
    let alive = true;
    void r.init({ width: host.clientWidth || 800, height: host.clientHeight || 450, resolution: window.devicePixelRatio || 1 }).then(() => {
      if (!alive) {
        r.destroy();
        return;
      }
      r.canvas.style.position = "absolute";
      r.canvas.style.inset = "0";
      host.prepend(r.canvas);
      rRef.current = r;
      setReady(true);
      perf.mark("ready");
    });
    return () => {
      alive = false;
      rRef.current = null;
      r.destroy();
      r.canvas.remove();
    };
  }, []);

  // ---------- render loop: only redraws when something changed ----------
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let lastSig = "";
    let dirtyMedia = true;
    const r = rRef.current;
    if (!r) return;
    r.onInvalidate = () => {
      dirtyMedia = true;
    };
    let frames = 0;
    let fpsT = performance.now();
    const loop = (): void => {
      raf = requestAnimationFrame(loop);
      const host = hostRef.current;
      const s = useProject.getState();
      const u = useUi.getState();
      const c = activeComp(s.project);
      if (!host || !c) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const dpr = (window.devicePixelRatio || 1) * u.res;
      if (r.canvas.width !== Math.round(w * dpr) || r.canvas.height !== Math.round(h * dpr)) r.resize(w, h, dpr);
      let scale = u.zoom;
      if (u.fitView) scale = Math.max(0.02, Math.min((w - 40) / c.width, (h - 40) / c.height));
      const ox = Math.round((w - c.width * scale) / 2 + u.pan[0]);
      const oy = Math.round((h - c.height * scale) / 2 + u.pan[1]);
      viewRef.current = { scale, ox, oy };
      r.setView(scale, ox, oy);

      const frameIndex = Math.round(s.currentTime * c.fps);
      const viewSig = `${c.id}|${s.revision}|${w}x${h}|${scale.toFixed(4)}|${ox}|${oy}|${u.res}|${u.transparencyGrid}`;
      frameCache.validate(viewSig);
      const sig = `${viewSig}|${frameIndex}|${s.selectedLayerIds.join(",")}|${u.safeGuides}|${u.tool}|${u.penPoints.length}|${dragRef.current ? Math.random() : 0}`;
      const cacheCanvas = cacheCanvasRef.current;
      const cached = u.playing ? frameCache.get(frameIndex) : undefined;
      if (cached && cacheCanvas) {
        if (cacheCanvas.width !== w || cacheCanvas.height !== h) {
          cacheCanvas.width = w;
          cacheCanvas.height = h;
        }
        const ctx = cacheCanvas.getContext("2d");
        ctx?.clearRect(0, 0, w, h);
        ctx?.drawImage(cached, 0, 0, w, h);
        cacheCanvas.style.visibility = "visible";
        r.media.pauseAll();
      } else {
        if (cacheCanvas) cacheCanvas.style.visibility = "hidden";
        if (sig !== lastSig || dirtyMedia || u.playing) {
          const t0 = performance.now();
          r.update(s.project, c, s.currentTime, { playing: u.playing }, u.transparencyGrid);
          if (u.playing) r.media.updatePlaying();
          drawOverlay(r, c, s.selectedLayerIds, s.currentTime, viewRef.current, u, dragRef.current);
          r.render(true);
          const ms = performance.now() - t0;
          perf.renderMs = perf.renderMs * 0.9 + ms * 0.1;
          lastSig = sig;
          dirtyMedia = false;
          if (u.playing && !frameCache.has(frameIndex) && frameCache.canStore(r.canvas.width, r.canvas.height)) {
            void createImageBitmap(r.canvas).then((bmp) => frameCache.put(frameIndex, bmp));
          }
        }
      }
      frames++;
      const now = performance.now();
      if (now - fpsT > 1000) {
        perf.fps = Math.round((frames * 1000) / (now - fpsT));
        frames = 0;
        fpsT = now;
        if (u.playing) frameCache.flush();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // ---------- RAM preview pre-render ----------
  useEffect(() => {
    if (!ready) return;
    registerPrerender(async (onProgress, shouldStop) => {
      const r = rRef.current;
      const s = useProject.getState();
      const c = activeComp(s.project);
      if (!r || !c) return;
      const [a, b] = c.workArea;
      const total = Math.round((b - a) * c.fps);
      for (let i = 0; i < total; i++) {
        if (shouldStop()) break;
        const f = Math.round(a * c.fps) + i;
        if (frameCache.has(f)) continue;
        if (!frameCache.canStore(r.canvas.width, r.canvas.height)) {
          useUi.getState().toast("RAM preview stopped: cache memory limit reached (Preferences › Memory)", "error");
          break;
        }
        const t = f / c.fps;
        useProject.getState().setTime(t);
        r.update(s.project, c, t, { playing: false }, useUi.getState().transparencyGrid);
        await r.seekVideos(s.project, c, t);
        r.update(s.project, c, t, { playing: false }, useUi.getState().transparencyGrid);
        drawOverlay(r, c, [], t, viewRef.current, useUi.getState(), null);
        r.render(true);
        frameCache.put(f, await createImageBitmap(r.canvas));
        onProgress(i + 1, total);
      }
      useProject.getState().setTime(a);
    });
    return () => registerPrerender(null);
  }, [ready]);

  // ---------- coordinate helpers ----------
  const toComp = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = hostRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return [0, 0];
    return [(e.clientX - rect.left - v.ox) / v.scale, (e.clientY - rect.top - v.oy) / v.scale];
  };

  const hitLayer = (c: Composition, p: Vec2): Layer | null => {
    const r = rRef.current;
    if (!r) return null;
    const t = useProject.getState().currentTime;
    for (const l of c.layers) {
      if (!l.visible || l.locked || l.kind === "audio" || t < l.inPoint || t >= l.outPoint) continue;
      const b = r.layerBounds(l.id);
      if (!b) continue;
      const local = apply(invert(worldMatrix(c, l, t)), p);
      if (local[0] >= b.x && local[0] <= b.x + b.w && local[1] >= b.y && local[1] <= b.y + b.h) return l;
    }
    return null;
  };

  const handleHit = (c: Composition, p: Vec2): { kind: "scale" | "rotate"; layer: Layer; center: Vec2 } | null => {
    const s = useProject.getState();
    if (s.selectedLayerIds.length !== 1) return null;
    const l = c.layers.find((x) => x.id === s.selectedLayerIds[0]);
    const r = rRef.current;
    if (!l || !r || l.locked) return null;
    const b = r.layerBounds(l.id);
    if (!b) return null;
    const m = worldMatrix(c, l, s.currentTime);
    const tol = (HANDLE + 3) / viewRef.current.scale;
    const corners: Vec2[] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ].map((q) => apply(m, q as Vec2));
    const center = apply(m, [b.x + b.w / 2, b.y + b.h / 2]);
    const top = apply(m, [b.x + b.w / 2, b.y]);
    const rotHandle: Vec2 = [top[0] + (top[0] - center[0]) * (30 / viewRef.current.scale / Math.max(1, Math.hypot(top[0] - center[0], top[1] - center[1]))), top[1] + (top[1] - center[1]) * (30 / viewRef.current.scale / Math.max(1, Math.hypot(top[0] - center[0], top[1] - center[1])))];
    if (Math.hypot(p[0] - rotHandle[0], p[1] - rotHandle[1]) < tol) return { kind: "rotate", layer: l, center: apply(m, resolveTransform(l, s.currentTime).anchor) };
    for (const q of corners) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < tol) return { kind: "scale", layer: l, center: apply(m, resolveTransform(l, s.currentTime).anchor) };
    return null;
  };

  // ---------- pointer handling ----------
  const onPointerDown = (e: React.PointerEvent): void => {
    const c = activeComp(useProject.getState().project);
    if (!c || e.button === 2) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = useProject.getState();
    const u = useUi.getState();
    const p = toComp(e);
    if (e.button === 1 || u.tool === "hand" || keyState.spaceDown) {
      keyState.spaceUsed = keyState.spaceDown;
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: u.pan[0], py: u.pan[1] };
      return;
    }
    if (u.tool === "pen") {
      const pts = u.penPoints;
      if (pts.length > 2 && Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]) < 10 / viewRef.current.scale) {
        cmd.addPathShape(pts as Vec2[], true);
        u.set({ penPoints: [] });
      } else u.set({ penPoints: [...pts, [p[0], p[1]]] });
      return;
    }
    if (u.tool === "text") {
      const id = cmd.addLayer("text", { text: "Text" });
      if (id) {
        cmd.setPropValue(id, "transform.position", [p[0], p[1]], "Place Text");
        const rect = hostRef.current?.getBoundingClientRect();
        setTextEdit({ id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), value: "Text" });
      }
      u.set({ tool: "select" });
      return;
    }
    if (u.tool === "rect" || u.tool === "ellipse" || u.tool === "polygon" || u.tool === "maskRect" || u.tool === "maskEllipse") {
      dragRef.current = { kind: "draw", tool: u.tool, a: p, b: p };
      return;
    }
    const h = handleHit(c, p);
    if (h && u.tool === "select") {
      const rt = resolveTransform(h.layer, s.currentTime);
      s.beginGesture(h.kind);
      if (h.kind === "scale") dragRef.current = { kind: "scale", id: h.layer.id, startScale: rt.scale, startDist: Math.max(1, Math.hypot(p[0] - h.center[0], p[1] - h.center[1])), center: h.center, uniform: true };
      else dragRef.current = { kind: "rotate", id: h.layer.id, startRot: rt.rotation, startAngle: Math.atan2(p[1] - h.center[1], p[0] - h.center[0]), center: h.center };
      return;
    }
    const hit = hitLayer(c, p);
    if (!hit) {
      if (!e.shiftKey) s.selectLayers([]);
      return;
    }
    let ids = s.selectedLayerIds;
    if (e.shiftKey) ids = ids.includes(hit.id) ? ids.filter((x) => x !== hit.id) : [...ids, hit.id];
    else if (!ids.includes(hit.id)) ids = [hit.id];
    s.selectLayers(ids);
    if (u.tool === "anchor") {
      const rt = resolveTransform(hit, s.currentTime);
      s.beginGesture("anchor");
      dragRef.current = { kind: "anchor", id: hit.id, sx: p[0], sy: p[1], anchor: rt.anchor, position: rt.position };
      return;
    }
    const starts = new Map<string, Vec2>();
    const inv = new Map<string, Mat>();
    for (const id of ids) {
      const l = c.layers.find((x) => x.id === id);
      if (!l || l.locked) continue;
      starts.set(id, resolveTransform(l, s.currentTime).position);
      const parent = l.parentId ? c.layers.find((x) => x.id === l.parentId) : undefined;
      inv.set(id, parent ? invert(worldMatrix(c, parent, s.currentTime)) : [1, 0, 0, 1, 0, 0]);
    }
    s.beginGesture("move");
    dragRef.current = { kind: "move", sx: p[0], sy: p[1], starts, inv };
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const p = toComp(e);
    useUi.getState().set({ cursor: [Math.round(p[0]), Math.round(p[1])] });
    const d = dragRef.current;
    if (!d) return;
    const s = useProject.getState();
    const c = activeComp(s.project);
    if (!c) return;
    switch (d.kind) {
      case "pan":
        useUi.getState().set({ pan: [d.px + e.clientX - d.sx, d.py + e.clientY - d.sy] });
        break;
      case "move":
        for (const [id, start] of d.starts) {
          const im = d.inv.get(id) ?? ([1, 0, 0, 1, 0, 0] as Mat);
          const a = apply(im, [d.sx, d.sy]);
          const b = apply(im, p);
          let dx = b[0] - a[0];
          let dy = b[1] - a[1];
          if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
          cmd.setPropValue(id, "transform.position", [Math.round((start[0] + dx) * 10) / 10, Math.round((start[1] + dy) * 10) / 10], "Move Layer");
        }
        break;
      case "scale": {
        const dist = Math.hypot(p[0] - d.center[0], p[1] - d.center[1]);
        const f = dist / d.startDist;
        cmd.setPropValue(d.id, "transform.scale", [Math.round(d.startScale[0] * f * 10) / 10, Math.round(d.startScale[1] * f * 10) / 10], "Scale Layer");
        break;
      }
      case "rotate": {
        const ang = Math.atan2(p[1] - d.center[1], p[0] - d.center[0]);
        let deg = d.startRot + ((ang - d.startAngle) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 45) * 45;
        cmd.setPropValue(d.id, "transform.rotation", Math.round(deg * 10) / 10, "Rotate Layer");
        break;
      }
      case "anchor": {
        const l = c.layers.find((x) => x.id === d.id);
        if (!l) break;
        const rt = resolveTransform(l, s.currentTime);
        const lin = localMatrix({ ...rt, position: [0, 0], anchor: [0, 0] });
        const world = worldMatrix(c, l, s.currentTime);
        const inv = invert(world);
        const a0 = apply(inv, [d.sx, d.sy]);
        const a1 = apply(inv, p);
        const dl: Vec2 = [a1[0] - a0[0], a1[1] - a0[1]];
        const dp = apply(lin, dl);
        cmd.setPropValue(d.id, "transform.anchor", [Math.round((d.anchor[0] + dl[0]) * 10) / 10, Math.round((d.anchor[1] + dl[1]) * 10) / 10], "Move Anchor");
        cmd.setPropValue(d.id, "transform.position", [Math.round((d.position[0] + dp[0]) * 10) / 10, Math.round((d.position[1] + dp[1]) * 10) / 10], "Move Anchor");
        dragRef.current = { ...d, sx: d.sx, sy: d.sy };
        break;
      }
      case "draw":
        dragRef.current = { ...d, b: e.shiftKey ? [d.a[0] + Math.sign(p[0] - d.a[0]) * Math.max(Math.abs(p[0] - d.a[0]), Math.abs(p[1] - d.a[1])), d.a[1] + Math.sign(p[1] - d.a[1]) * Math.max(Math.abs(p[0] - d.a[0]), Math.abs(p[1] - d.a[1]))] : p };
        rRef.current?.invalidate();
        break;
    }
  };

  const onPointerUp = (): void => {
    const d = dragRef.current;
    dragRef.current = null;
    const s = useProject.getState();
    s.endGesture();
    if (!d || d.kind !== "draw") return;
    const c = activeComp(s.project);
    if (!c) return;
    const x = Math.min(d.a[0], d.b[0]);
    const y = Math.min(d.a[1], d.b[1]);
    const w = Math.abs(d.b[0] - d.a[0]);
    const h = Math.abs(d.b[1] - d.a[1]);
    if (w < 3 || h < 3) return;
    if (d.tool === "maskRect" || d.tool === "maskEllipse") {
      const id = s.selectedLayerIds[0];
      const l = c.layers.find((x2) => x2.id === id);
      if (!l) {
        useUi.getState().toast("Select a layer first, then draw a mask on it.", "error");
        return;
      }
      const inv = invert(worldMatrix(c, l, s.currentTime));
      const a = apply(inv, [x, y]);
      const b = apply(inv, [x + w, y + h]);
      cmd.addMask(l.id, d.tool === "maskRect" ? "rect" : "ellipse", [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]);
      return;
    }
    cmd.addShapeLayer(d.tool === "rect" ? "rect" : d.tool === "ellipse" ? "ellipse" : "polygon", [Math.round(w), Math.round(h)], [x + w / 2, y + h / 2]);
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    const c = activeComp(useProject.getState().project);
    const u = useUi.getState();
    if (!c) return;
    if (u.tool === "pen" && u.penPoints.length >= 2) {
      cmd.addPathShape(u.penPoints as Vec2[], false);
      u.set({ penPoints: [] });
      return;
    }
    const hit = hitLayer(c, toComp(e));
    if (hit?.kind === "text" && hit.text) {
      const rect = hostRef.current?.getBoundingClientRect();
      setTextEdit({ id: hit.id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), value: hit.text.text });
    }
  };

  const onWheel = (e: React.WheelEvent): void => {
    const u = useUi.getState();
    if (e.ctrlKey || e.altKey) {
      const v = viewRef.current;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const zoom = Math.max(0.02, Math.min(4, v.scale * f));
      const rect = hostRef.current?.getBoundingClientRect();
      const mx = e.clientX - (rect?.left ?? 0);
      const my = e.clientY - (rect?.top ?? 0);
      const w = hostRef.current?.clientWidth ?? 0;
      const h = hostRef.current?.clientHeight ?? 0;
      const c = activeComp(useProject.getState().project);
      if (!c) return;
      const compX = (mx - v.ox) / v.scale;
      const compY = (my - v.oy) / v.scale;
      const nox = mx - compX * zoom;
      const noy = my - compY * zoom;
      u.set({ zoom, fitView: false, pan: [nox - (w - c.width * zoom) / 2, noy - (h - c.height * zoom) / 2] });
    } else {
      u.set({ pan: [u.pan[0] - e.deltaX, u.pan[1] - e.deltaY] });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const u = useUi.getState();
      if (u.tool !== "pen" || !u.penPoints.length) return;
      if (e.key === "Enter") {
        cmd.addPathShape(u.penPoints as Vec2[], false);
        u.set({ penPoints: [] });
      }
      if (e.key === "Escape") u.set({ penPoints: [] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!comp) return <Empty>No composition. Use Composition › New Composition (Ctrl+N).</Empty>;

  const zoomPct = ui.fitView ? "fit" : String(Math.round(ui.zoom * 100));
  const cursorClass = ui.tool === "hand" ? "cursor-grab" : ui.tool === "select" ? "cursor-default" : "cursor-crosshair";

  return (
    <div className="panel-root">
      <div className="panel-bar">
        {TOOLS.map((t) => (
          <button key={t.tool} type="button" className="icon-btn" data-on={ui.tool === t.tool} aria-label={t.label} title={t.label} onClick={() => ui.set({ tool: t.tool, penPoints: [] })}>
            {t.icon}
          </button>
        ))}
        <span className="flex-1" />
        <span className="mono text-[11px] text-[#cfcfcf]">{formatTimecode(currentTime, comp.fps)}</span>
        <Select
          label="Magnification"
          width={68}
          value={zoomPct}
          options={[{ value: "fit", label: "Fit" }, ...["25", "50", "100", "200", "400"].map((v) => ({ value: v, label: `${v}%` })), ...(ui.fitView || ["25", "50", "100", "200", "400"].includes(zoomPct) ? [] : [{ value: zoomPct, label: `${zoomPct}%` }])]}
          onChange={(v) => (v === "fit" ? ui.set({ fitView: true, pan: [0, 0] }) : ui.set({ zoom: Number(v) / 100, fitView: false, pan: [0, 0] }))}
        />
        <Select label="Resolution" width={78} value={String(ui.res)} options={[{ value: "1", label: "Full" }, { value: "0.5", label: "Half" }, { value: "0.25", label: "Quarter" }]} onChange={(v) => ui.set({ res: Number(v) as 1 | 0.5 | 0.25 })} />
        <button type="button" className="icon-btn" data-on={ui.transparencyGrid} aria-label="Transparency grid" title="Transparency grid" onClick={() => ui.set({ transparencyGrid: !ui.transparencyGrid })}>
          <Grid3x3 size={15} />
        </button>
        <button type="button" className="icon-btn" data-on={ui.safeGuides} aria-label="Title/action safe" title="Title/Action safe (')" onClick={() => ui.set({ safeGuides: !ui.safeGuides })}>
          <Frame size={15} />
        </button>
      </div>
      <div
        ref={hostRef}
        className={`relative flex-1 min-h-0 overflow-hidden bg-[#121212] ${cursorClass}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => useUi.getState().set({ cursor: null })}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const mediaId = e.dataTransfer.getData("application/x-minifx-media");
          const m = useProject.getState().project.media.find((x) => x.id === mediaId);
          if (m) cmd.addMediaLayer(m);
        }}
        role="application"
        aria-label="Composition viewer"
      >
        <canvas ref={cacheCanvasRef} className="absolute inset-0 pointer-events-none" style={{ visibility: "hidden", width: "100%", height: "100%" }} />
        {textEdit && (
          <textarea
            autoFocus
            aria-label="Edit text"
            className="absolute z-10 field"
            style={{ left: textEdit.x - 120, top: textEdit.y - 24, width: 240, height: 64, fontSize: 16 }}
            value={textEdit.value}
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setTextEdit(null);
              if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            onBlur={() => {
              cmd.updateText(textEdit.id, { text: textEdit.value || " " });
              setTextEdit(null);
            }}
          />
        )}
        {ui.tool === "pen" && ui.penPoints.length > 0 && (
          <div className="absolute bottom-2 left-2 text-[11px] bg-black/60 px-2 py-1 rounded pointer-events-none">Click to add points · click first point to close · Enter or double-click for open path · Esc cancels</div>
        )}
      </div>
    </div>
  );
}

function drawOverlay(r: CompRenderer, c: Composition, selected: string[], t: number, v: { scale: number; ox: number; oy: number }, u: ReturnType<typeof useUi.getState>, drag: Drag | null): void {
  let g = r.overlay.children[0] as Graphics | undefined;
  if (!g) {
    g = new Graphics();
    r.overlay.addChild(g);
  }
  r.overlay.visible = true;
  g.clear();
  const S = (p: Vec2): Vec2 => [v.ox + p[0] * v.scale, v.oy + p[1] * v.scale];
  // comp frame outline
  g.rect(v.ox - 0.5, v.oy - 0.5, c.width * v.scale + 1, c.height * v.scale + 1).stroke({ color: 0x444444, width: 1 });
  if (u.safeGuides) {
    for (const f of [0.9, 0.8]) {
      const w = c.width * f * v.scale;
      const h = c.height * f * v.scale;
      g.rect(v.ox + (c.width * v.scale - w) / 2, v.oy + (c.height * v.scale - h) / 2, w, h).stroke({ color: 0x6fa8ff, width: 1, alpha: 0.6 });
    }
    const cx = v.ox + (c.width * v.scale) / 2;
    const cy = v.oy + (c.height * v.scale) / 2;
    g.moveTo(cx - 8, cy).lineTo(cx + 8, cy).moveTo(cx, cy - 8).lineTo(cx, cy + 8).stroke({ color: 0x6fa8ff, width: 1, alpha: 0.6 });
  }
  for (const id of selected) {
    const l = c.layers.find((x) => x.id === id);
    const b = r.layerBounds(id);
    if (!l || !b || t < l.inPoint || t >= l.outPoint) continue;
    const m = worldMatrix(c, l, t);
    const pts = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ].map((q) => S(apply(m, q as Vec2)));
    g.poly(pts.flat(), true).stroke({ color: 0x3d8bfd, width: 1 });
    for (const q of pts) g.rect(q[0] - HANDLE / 2, q[1] - HANDLE / 2, HANDLE, HANDLE).fill({ color: 0xffffff }).stroke({ color: 0x3d8bfd, width: 1 });
    // rotation handle above the top edge
    const center = S(apply(m, [b.x + b.w / 2, b.y + b.h / 2]));
    const top = S(apply(m, [b.x + b.w / 2, b.y]));
    const len = Math.max(1, Math.hypot(top[0] - center[0], top[1] - center[1]));
    const rot: Vec2 = [top[0] + ((top[0] - center[0]) / len) * 30, top[1] + ((top[1] - center[1]) / len) * 30];
    if (selected.length === 1) g.moveTo(top[0], top[1]).lineTo(rot[0], rot[1]).stroke({ color: 0x3d8bfd, width: 1 }).circle(rot[0], rot[1], 5).fill({ color: 0xffffff }).stroke({ color: 0x3d8bfd, width: 1 });
    // anchor point
    const a = S(apply(m, resolveTransform(l, t).anchor));
    g.circle(a[0], a[1], 5).stroke({ color: 0xffffff, width: 1 }).moveTo(a[0] - 8, a[1]).lineTo(a[0] + 8, a[1]).moveTo(a[0], a[1] - 8).lineTo(a[0], a[1] + 8).stroke({ color: 0xffffff, width: 1 });
    // masks
    for (const mk of l.masks) {
      const [x, y, w, h] = mk.box;
      if (mk.kind === "path" && mk.path.length > 2) g.poly(mk.path.map((q) => S(apply(m, q))).flat(), true).stroke({ color: 0xf5d547, width: 1 });
      else g.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((q) => S(apply(m, q as Vec2))).flat(), true).stroke({ color: 0xf5d547, width: 1, alpha: mk.kind === "ellipse" ? 0.4 : 1 });
    }
  }
  if (u.penPoints.length) {
    const pts = u.penPoints.map((p) => S(p as Vec2));
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.stroke({ color: 0x3d8bfd, width: 1.5 });
    for (const p of pts) g.rect(p[0] - 3, p[1] - 3, 6, 6).fill({ color: 0xffffff });
  }
  if (drag?.kind === "draw") {
    const a = S(drag.a);
    const b = S(drag.b);
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    const w = Math.abs(b[0] - a[0]);
    const h = Math.abs(b[1] - a[1]);
    const color = drag.tool.startsWith("mask") ? 0xf5d547 : 0x3d8bfd;
    if (drag.tool === "ellipse" || drag.tool === "maskEllipse") g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2).stroke({ color, width: 1 });
    else g.rect(x, y, w, h).stroke({ color, width: 1 });
  }
}
