// Every edit goes through `execute`, which records immer patches as an undoable
// command. Functions here are the only place UI/AI code changes the project.
import type { Draft } from "immer";
import { createEffect } from "../engine/effects";
import { createComposition, createLayer, createMask, type CompSettings, type LayerInit } from "../engine/factory";
import { apply, IDENTITY, invert, localTime, multiply, worldMatrix, type Mat } from "../engine/evaluate";
import { clamp, makeKey, sortKeys, uid, valueAt } from "../engine/interpolation";
import type { AnimProp, BlendMode, Composition, Interp, Keyframe, Layer, LayerKind, Mask, MediaItem, ParamValue, Project, Vec2 } from "../engine/types";
import { activeComp, getProp, useProject } from "../store/projectStore";

type DProject = Draft<Project>;
type DComp = Draft<Composition>;
type DLayer = Draft<Layer>;

const st = () => useProject.getState();

function ex(label: string, fn: (p: DProject) => void): void {
  st().execute(label, fn);
}

function dComp(p: DProject): DComp | undefined {
  return (p.compositions.find((c) => c.id === p.activeCompId) ?? p.compositions[0]) as DComp | undefined;
}

function dLayer(p: DProject, id: string): DLayer | undefined {
  for (const c of p.compositions) {
    const l = c.layers.find((x) => x.id === id);
    if (l) return l as DLayer;
  }
  return undefined;
}

function dProp(l: DLayer, path: string): Draft<AnimProp> | undefined {
  return getProp(l as Layer, path) as Draft<AnimProp> | undefined;
}

export function currentComp(): Composition | undefined {
  return activeComp(st().project);
}

// ---------------- compositions ----------------
export function newComposition(settings: Partial<CompSettings>): string {
  const c = createComposition(settings);
  ex("New Composition", (p) => {
    p.compositions.push(c as Draft<Composition>);
    p.activeCompId = c.id;
  });
  return c.id;
}

export function updateComposition(id: string, patch: Partial<CompSettings>): void {
  ex("Composition Settings", (p) => {
    const c = p.compositions.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
    if (patch.duration !== undefined) c.workArea = [Math.min(c.workArea[0], patch.duration), Math.min(Math.max(c.workArea[1], 0.1), patch.duration)];
  });
}

export function setActiveComp(id: string): void {
  ex("Open Composition", (p) => {
    p.activeCompId = id;
  });
}

export function setWorkArea(start: number, end: number): void {
  ex("Work Area", (p) => {
    const c = dComp(p);
    if (!c) return;
    const a = clamp(Math.min(start, end), 0, c.duration);
    const b = clamp(Math.max(start, end), 0, c.duration);
    c.workArea = [a, Math.max(a + 1 / c.fps, b)];
  });
}

export function addMarker(time: number, label = ""): void {
  ex("Add Marker", (p) => {
    dComp(p)?.markers.push({ id: uid("mk"), time, label });
  });
}

// ---------------- media ----------------
export function addMedia(items: MediaItem[]): void {
  if (!items.length) return;
  ex(items.length > 1 ? `Import ${items.length} files` : `Import ${items[0].name}`, (p) => {
    for (const m of items) p.media.push(m as Draft<MediaItem>);
  });
}

export function updateMedia(id: string, patch: Partial<MediaItem>): void {
  // background processing results should not create undo steps
  const s = st();
  const project: Project = {
    ...s.project,
    media: s.project.media.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  };
  useProject.setState({ project, revision: s.revision + 1 });
}

export function removeMedia(id: string): void {
  ex("Remove Footage", (p) => {
    p.media = p.media.filter((m) => m.id !== id);
    for (const c of p.compositions) c.layers = c.layers.filter((l) => l.sourceId !== id);
  });
}

// ---------------- layers ----------------
export function addLayer(kind: LayerKind, init: LayerInit = {}): string | null {
  const comp = currentComp();
  if (!comp) return null;
  const layer = createLayer(kind, comp, { start: init.start ?? st().currentTime, ...init });
  if (init.media && (kind === "video" || kind === "image")) {
    // fit large media into the comp like AE "fit to comp" when bigger
    const s = Math.min(comp.width / init.media.width, comp.height / init.media.height, 1) * 100;
    layer.transform.scale.value = [Math.round(s * 100) / 100, Math.round(s * 100) / 100];
  }
  ex(`New ${layer.name}`, (p) => {
    dComp(p)?.layers.unshift(layer as DLayer);
  });
  st().selectLayers([layer.id]);
  return layer.id;
}

export function addMediaLayer(media: MediaItem, start?: number): string | null {
  const kind: LayerKind = media.kind === "audio" ? "audio" : media.kind === "image" ? "image" : "video";
  return addLayer(kind, { media, start: start ?? st().currentTime });
}

export function deleteLayers(ids: string[]): void {
  if (!ids.length) return;
  ex(ids.length > 1 ? "Delete Layers" : "Delete Layer", (p) => {
    const c = dComp(p);
    if (!c) return;
    c.layers = c.layers.filter((l) => !ids.includes(l.id));
    for (const l of c.layers) if (l.parentId && ids.includes(l.parentId)) l.parentId = null;
  });
  st().selectLayers([]);
}

export function duplicateLayers(ids: string[]): void {
  const newIds: string[] = [];
  ex("Duplicate Layers", (p) => {
    const c = dComp(p);
    if (!c) return;
    for (const id of ids) {
      const i = c.layers.findIndex((l) => l.id === id);
      if (i < 0) continue;
      const copy = JSON.parse(JSON.stringify(c.layers[i])) as Layer;
      copy.id = uid("layer");
      copy.name = `${copy.name} copy`;
      newIds.push(copy.id);
      c.layers.splice(i, 0, copy as DLayer);
    }
  });
  st().selectLayers(newIds);
}

export function updateLayer(id: string, label: string, fn: (l: DLayer) => void): void {
  ex(label, (p) => {
    const l = dLayer(p, id);
    if (l) fn(l);
  });
}

export function renameLayer(id: string, name: string): void {
  updateLayer(id, "Rename Layer", (l) => {
    l.name = name;
  });
}

export function toggleLayerFlag(id: string, flag: "visible" | "solo" | "locked" | "shy" | "audioEnabled"): void {
  updateLayer(id, `Toggle ${flag}`, (l) => {
    l[flag] = !l[flag];
  });
}

export function setLabel(id: string, label: number): void {
  updateLayer(id, "Label Color", (l) => {
    l.label = label;
  });
}

export function setBlend(ids: string[], blend: BlendMode): void {
  ex("Blend Mode", (p) => {
    for (const id of ids) {
      const l = dLayer(p, id);
      if (l) l.blend = blend;
    }
  });
}

function wouldCycle(comp: Composition, childId: string, parentId: string | null): boolean {
  let cur = parentId;
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur === childId) return true;
    cur = comp.layers.find((l) => l.id === cur)?.parentId ?? null;
  }
  return false;
}

/** Re-parent without the layer jumping (like After Effects): converts the
 * layer's position/rotation/scale from the old parent space into the new one. */
export function setParent(id: string, parentId: string | null): boolean {
  const comp = currentComp();
  if (!comp || (parentId && wouldCycle(comp, id, parentId))) return false;
  const layer = comp.layers.find((l) => l.id === id);
  if (!layer) return false;
  const t = st().currentTime;
  const oldParent = layer.parentId ? comp.layers.find((l) => l.id === layer.parentId) : undefined;
  const newParent = parentId ? comp.layers.find((l) => l.id === parentId) : undefined;
  const oldM: Mat = oldParent ? worldMatrix(comp, oldParent, t) : IDENTITY;
  const newM: Mat = newParent ? worldMatrix(comp, newParent, t) : IDENTITY;
  const conv = multiply(invert(newM), oldM);
  const rotOf = (m: Mat): number => (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const scaleOf = (m: Mat): Vec2 => [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])];
  const dRot = rotOf(oldM) - rotOf(newM);
  const so = scaleOf(oldM);
  const sn = scaleOf(newM);
  const sx = sn[0] > 1e-9 ? so[0] / sn[0] : 1;
  const sy = sn[1] > 1e-9 ? so[1] / sn[1] : 1;
  updateLayer(id, "Parent", (l) => {
    l.parentId = parentId;
    const tr = l.transform;
    tr.position.value = apply(conv, tr.position.value as Vec2);
    for (const k of tr.position.keyframes) k.value = apply(conv, k.value as Vec2);
    tr.rotation.value += dRot;
    for (const k of tr.rotation.keyframes) k.value += dRot;
    tr.scale.value = [tr.scale.value[0] * sx, tr.scale.value[1] * sy];
    for (const k of tr.scale.keyframes) k.value = [k.value[0] * sx, k.value[1] * sy];
  });
  return true;
}

export function reorderLayer(id: string, toIndex: number): void {
  ex("Reorder Layer", (p) => {
    const c = dComp(p);
    if (!c) return;
    const from = c.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [l] = c.layers.splice(from, 1);
    c.layers.splice(clamp(toIndex, 0, c.layers.length), 0, l);
  });
}

/** Move the whole bar (start + in/out + keyframes move together). */
export function shiftLayers(ids: string[], delta: number): void {
  ex("Move Layer in Time", (p) => {
    for (const id of ids) {
      const l = dLayer(p, id);
      if (!l || l.locked) continue;
      l.start += delta;
      l.inPoint += delta;
      l.outPoint += delta;
    }
  });
}

export function trimLayer(id: string, edge: "in" | "out", time: number): void {
  updateLayer(id, edge === "in" ? "Trim In Point" : "Trim Out Point", (l) => {
    if (l.locked) return;
    if (edge === "in") l.inPoint = Math.min(time, l.outPoint - 0.01);
    else l.outPoint = Math.max(time, l.inPoint + 0.01);
  });
}

export function splitLayers(ids: string[], time: number): void {
  const created: string[] = [];
  ex("Split Layer", (p) => {
    const c = dComp(p);
    if (!c) return;
    for (const id of ids) {
      const i = c.layers.findIndex((l) => l.id === id);
      const l = c.layers[i];
      if (!l || time <= l.inPoint || time >= l.outPoint) continue;
      const copy = JSON.parse(JSON.stringify(l)) as Layer;
      copy.id = uid("layer");
      copy.inPoint = time;
      l.outPoint = time;
      created.push(copy.id);
      c.layers.splice(i, 0, copy as DLayer);
    }
  });
  if (created.length) st().selectLayers(created);
}

// ---------------- properties & keyframes ----------------
/** Sets a property at the current time: writes a keyframe if animated, else the static value. */
export function setPropValue(layerId: string, path: string, value: ParamValue, label = "Change Value"): void {
  const t = st().currentTime;
  ex(label, (p) => {
    const l = dLayer(p, layerId);
    if (!l) return;
    const prop = dProp(l, path);
    if (!prop) return;
    if (prop.keyframes.length === 0) {
      prop.value = value as Draft<ParamValue>;
      return;
    }
    const lt = Math.round(localTime(l as Layer, t) * 1000) / 1000;
    const existing = prop.keyframes.find((k) => Math.abs(k.time - lt) < 1e-3);
    if (existing) existing.value = value as Draft<ParamValue>;
    else prop.keyframes.push(makeKey(lt, value, "linear") as Draft<Keyframe>);
  });
}

export function toggleStopwatch(layerId: string, path: string): void {
  const t = st().currentTime;
  ex("Toggle Keyframes", (p) => {
    const l = dLayer(p, layerId);
    if (!l) return;
    const prop = dProp(l, path);
    if (!prop) return;
    const lt = localTime(l as Layer, t);
    if (prop.keyframes.length) {
      prop.value = valueAt(prop as AnimProp, lt) as Draft<ParamValue>;
      prop.keyframes = [];
    } else {
      prop.keyframes = [makeKey(lt, prop.value as ParamValue) as Draft<Keyframe>];
    }
  });
}

export function addKeyframeAtTime(layerId: string, path: string, compTime?: number): void {
  const t = compTime ?? st().currentTime;
  ex("Add Keyframe", (p) => {
    const l = dLayer(p, layerId);
    if (!l) return;
    const prop = dProp(l, path);
    if (!prop) return;
    const lt = Math.round(localTime(l as Layer, t) * 1000) / 1000;
    if (prop.keyframes.some((k) => Math.abs(k.time - lt) < 1e-3)) return;
    const v = valueAt(prop as AnimProp, lt);
    prop.keyframes.push(makeKey(lt, v) as Draft<Keyframe>);
  });
}

export function removeKeyframeAt(layerId: string, path: string, compTime: number): void {
  ex("Remove Keyframe", (p) => {
    const l = dLayer(p, layerId);
    if (!l) return;
    const prop = dProp(l, path);
    if (!prop) return;
    const lt = localTime(l as Layer, compTime);
    const hit = prop.keyframes.find((k) => Math.abs(k.time - lt) < 1e-3);
    if (!hit) return;
    if (prop.keyframes.length === 1) prop.value = hit.value;
    prop.keyframes = prop.keyframes.filter((k) => k.id !== hit.id);
  });
}

function forEachSelectedKey(p: DProject, fn: (k: Draft<Keyframe>, prop: Draft<AnimProp>, l: DLayer) => void): void {
  for (const sel of st().selectedKeys) {
    const l = dLayer(p, sel.layerId);
    const prop = l ? dProp(l, sel.path) : undefined;
    const k = prop?.keyframes.find((x) => x.id === sel.keyId);
    if (l && prop && k) fn(k, prop, l);
  }
}

export function deleteSelectedKeys(): void {
  if (!st().selectedKeys.length) return;
  ex("Delete Keyframes", (p) => {
    const sel = st().selectedKeys;
    for (const s of sel) {
      const l = dLayer(p, s.layerId);
      const prop = l ? dProp(l, s.path) : undefined;
      if (!prop) continue;
      const k = prop.keyframes.find((x) => x.id === s.keyId);
      if (k && prop.keyframes.length === 1) prop.value = k.value;
      prop.keyframes = prop.keyframes.filter((x) => x.id !== s.keyId);
    }
  });
  st().selectKeys([]);
}

export function moveSelectedKeys(delta: number): void {
  ex("Move Keyframes", (p) => {
    forEachSelectedKey(p, (k) => {
      k.time = Math.round((k.time + delta) * 1000) / 1000;
    });
  });
}

export function setSelectedInterp(interp: Interp): void {
  ex(`Keyframe ${interp}`, (p) => {
    forEachSelectedKey(p, (k) => {
      k.interp = interp;
      if (interp === "bezier" && k.easeIn === 0 && k.easeOut === 0) {
        k.easeIn = 0.333;
        k.easeOut = 0.333;
      }
      if (interp === "linear") {
        k.easeIn = 0;
        k.easeOut = 0;
      }
    });
  });
}

export function easyEaseSelected(kind: "both" | "in" | "out" = "both"): void {
  ex("Easy Ease", (p) => {
    forEachSelectedKey(p, (k) => {
      k.interp = "bezier";
      if (kind !== "out") k.easeIn = 0.333;
      if (kind !== "in") k.easeOut = 0.333;
    });
  });
}

export function setKeyInfluence(sel: { layerId: string; path: string; keyId: string }, side: "in" | "out", value: number): void {
  ex("Keyframe Influence", (p) => {
    const l = dLayer(p, sel.layerId);
    const prop = l ? dProp(l, sel.path) : undefined;
    const k = prop?.keyframes.find((x) => x.id === sel.keyId);
    if (!k) return;
    k.interp = "bezier";
    if (side === "in") k.easeIn = clamp(value, 0, 1);
    else k.easeOut = clamp(value, 0, 1);
  });
}

let clipboard: { path: string; keys: Keyframe[] }[] = [];

export function copySelectedKeys(): number {
  const p = st().project;
  const groups = new Map<string, Keyframe[]>();
  for (const s of st().selectedKeys) {
    const l = p.compositions.flatMap((c) => c.layers).find((x) => x.id === s.layerId);
    const prop = l ? getProp(l, s.path) : undefined;
    const k = prop?.keyframes.find((x) => x.id === s.keyId);
    if (!k) continue;
    groups.set(s.path, [...(groups.get(s.path) ?? []), k]);
  }
  clipboard = [...groups.entries()].map(([path, keys]) => {
    const sorted = sortKeys(keys);
    const t0 = sorted[0]?.time ?? 0;
    return { path, keys: sorted.map((k) => ({ ...k, time: k.time - t0 })) };
  });
  return clipboard.reduce((n, g) => n + g.keys.length, 0);
}

export function pasteKeys(layerId: string): void {
  if (!clipboard.length) return;
  const t = st().currentTime;
  ex("Paste Keyframes", (p) => {
    const l = dLayer(p, layerId);
    if (!l) return;
    const lt = localTime(l as Layer, t);
    for (const g of clipboard) {
      const prop = dProp(l, g.path);
      if (!prop) continue;
      for (const k of g.keys) {
        const time = Math.round((lt + k.time) * 1000) / 1000;
        prop.keyframes = prop.keyframes.filter((x) => Math.abs(x.time - time) >= 1e-3);
        prop.keyframes.push({ ...k, id: uid("k"), time } as Draft<Keyframe>);
      }
    }
  });
}

// ---------------- effects ----------------
export function addEffect(layerIds: string[], type: string): void {
  ex("Add Effect", (p) => {
    for (const id of layerIds) {
      const l = dLayer(p, id);
      if (l) l.effects.push(createEffect(type) as Draft<Layer["effects"][number]>);
    }
  });
}

export function removeEffect(layerId: string, fxId: string): void {
  updateLayer(layerId, "Remove Effect", (l) => {
    l.effects = l.effects.filter((e) => e.id !== fxId);
  });
}

export function toggleEffect(layerId: string, fxId: string): void {
  updateLayer(layerId, "Toggle Effect", (l) => {
    const fx = l.effects.find((e) => e.id === fxId);
    if (fx) fx.enabled = !fx.enabled;
  });
}

export function resetEffect(layerId: string, fxId: string): void {
  updateLayer(layerId, "Reset Effect", (l) => {
    const i = l.effects.findIndex((e) => e.id === fxId);
    if (i < 0) return;
    const fresh = createEffect(l.effects[i].type);
    fresh.id = fxId;
    l.effects[i] = fresh as Draft<Layer["effects"][number]>;
  });
}

export function moveEffect(layerId: string, fxId: string, dir: -1 | 1): void {
  updateLayer(layerId, "Reorder Effect", (l) => {
    const i = l.effects.findIndex((e) => e.id === fxId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.effects.length) return;
    const [fx] = l.effects.splice(i, 1);
    l.effects.splice(j, 0, fx);
  });
}

// ---------------- text / shape / masks ----------------
export function updateText(layerId: string, patch: Partial<NonNullable<Layer["text"]>>): void {
  updateLayer(layerId, "Edit Text", (l) => {
    if (!l.text) return;
    Object.assign(l.text, patch);
    if (patch.text !== undefined && /^Text|^[^\n]{0,24}$/.test(l.name)) l.name = patch.text.split("\n")[0].slice(0, 24) || "Text";
  });
}

export function updateShape(layerId: string, patch: Partial<Omit<NonNullable<Layer["shape"]>, "size">>): void {
  updateLayer(layerId, "Edit Shape", (l) => {
    if (l.shape) Object.assign(l.shape, patch);
  });
}

export function addShapeLayer(kind: "rect" | "ellipse" | "polygon", size: Vec2, position: Vec2): string | null {
  const id = addLayer("shape", { shapeKind: kind, size, name: kind === "rect" ? "Rectangle" : kind === "ellipse" ? "Ellipse" : "Polygon" });
  if (id) setPropValue(id, "transform.position", position, "Place Shape");
  return id;
}

export function addPathShape(points: Vec2[], closed: boolean): string | null {
  if (points.length < 2) return null;
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const maxY = Math.max(...points.map((p) => p[1]));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const id = addLayer("shape", { shapeKind: "path", size: [maxX - minX, maxY - minY], name: "Shape Path" });
  if (!id) return null;
  updateLayer(id, "Pen Path", (l) => {
    if (!l.shape) return;
    l.shape.path = points.map((p) => [p[0] - cx, p[1] - cy] as Vec2);
    l.shape.closed = closed;
    l.shape.fillEnabled = closed;
    if (!closed) l.shape.strokeWidth = 6;
    l.transform.position.value = [cx, cy];
  });
  return id;
}

export function addMask(layerId: string, kind: Mask["kind"], box?: [number, number, number, number], path?: Vec2[]): void {
  updateLayer(layerId, "Add Mask", (l) => {
    const w = l.solid?.width ?? 1000;
    const h = l.solid?.height ?? 1000;
    const m = createMask(kind, w, h, l.masks.length + 1);
    if (box) m.box = box;
    if (path) m.path = path;
    l.masks.push(m as Draft<Mask>);
  });
}

export function updateMask(layerId: string, maskId: string, patch: Partial<Mask>): void {
  updateLayer(layerId, "Edit Mask", (l) => {
    const m = l.masks.find((x) => x.id === maskId);
    if (m) Object.assign(m, patch);
  });
}

export function removeMask(layerId: string, maskId: string): void {
  updateLayer(layerId, "Delete Mask", (l) => {
    l.masks = l.masks.filter((m) => m.id !== maskId);
  });
}
