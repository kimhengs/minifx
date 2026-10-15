import { valueAt } from "./interpolation";
import type { Composition, Layer, ParamValue, Vec2 } from "./types";

/** 2D affine matrix [a, b, c, d, tx, ty] mapping (x, y) -> (a x + c y + tx, b x + d y + ty). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  // returns m * n (apply n first, then m)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export interface ResolvedTransform {
  anchor: Vec2;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
}

export function localTime(layer: Layer, compTime: number): number {
  return compTime - layer.start;
}

export function resolveTransform(layer: Layer, compTime: number): ResolvedTransform {
  const t = localTime(layer, compTime);
  const tr = layer.transform;
  return {
    anchor: valueAt(tr.anchor, t),
    position: valueAt(tr.position, t),
    scale: valueAt(tr.scale, t),
    rotation: valueAt(tr.rotation, t),
    opacity: valueAt(tr.opacity, t),
  };
}

/** Local matrix: translate(position) * rotate * scale * translate(-anchor) */
export function localMatrix(r: ResolvedTransform): Mat {
  const rad = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = r.scale[0] / 100;
  const sy = r.scale[1] / 100;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const tx = r.position[0] - (a * r.anchor[0] + c * r.anchor[1]);
  const ty = r.position[1] - (b * r.anchor[0] + d * r.anchor[1]);
  return [a, b, c, d, tx, ty];
}

/** World matrix including the parent chain (parent opacity is not inherited, like AE). */
export function worldMatrix(comp: Composition, layer: Layer, compTime: number, depth = 0): Mat {
  const local = localMatrix(resolveTransform(layer, compTime));
  if (!layer.parentId || depth > 32) return local;
  const parent = comp.layers.find((l) => l.id === layer.parentId);
  if (!parent) return local;
  return multiply(worldMatrix(comp, parent, compTime, depth + 1), local);
}

export function isActiveAt(layer: Layer, compTime: number): boolean {
  return compTime >= layer.inPoint && compTime < layer.outPoint;
}

/** Layers that should render at this time, bottom-most first. Honors solo. */
export function renderOrder(comp: Composition, compTime: number): Layer[] {
  const anySolo = comp.layers.some((l) => l.solo && l.kind !== "audio");
  return [...comp.layers]
    .reverse()
    .filter((l) => l.visible && (!anySolo || l.solo) && l.kind !== "audio" && l.kind !== "null" && isActiveAt(l, compTime));
}

/** Natural size of a layer's content in layer space (used for bounds/handles). */
export function contentSize(layer: Layer, media?: { width: number; height: number }): Vec2 {
  switch (layer.kind) {
    case "video":
    case "image":
      return media ? [media.width, media.height] : [100, 100];
    case "solid":
    case "adjustment":
      return layer.solid ? [layer.solid.width, layer.solid.height] : [100, 100];
    case "shape":
      return layer.shape ? valueAt(layer.shape.size, 0) : [100, 100];
    case "text": {
      const td = layer.text;
      if (!td) return [100, 40];
      const lines = td.text.split("\n");
      const longest = Math.max(...lines.map((l) => l.length), 1);
      return [longest * td.size * 0.55 + longest * td.tracking, lines.length * td.size * (td.leading / 100 || 1.2)];
    }
    default:
      return [0, 0];
  }
}

export function effectParam(layer: Layer, effectIndex: number, key: string, compTime: number): ParamValue | undefined {
  const fx = layer.effects[effectIndex];
  const p = fx?.params[key];
  return p ? valueAt(p, localTime(layer, compTime)) : undefined;
}
