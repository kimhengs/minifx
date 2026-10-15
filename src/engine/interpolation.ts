import type { AnimProp, Keyframe, ParamValue, Vec2 } from "./types";

let counter = 0;
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Solve a CSS-style cubic bezier (P0=(0,0), P3=(1,1)) for y at x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** Easing between two keyframes, After Effects style influence. */
export function easeBetween(a: Keyframe, b: Keyframe, u: number): number {
  if (a.interp === "hold") return 0;
  if (a.interp === "linear" && b.interp !== "bezier") return u;
  const outI = a.interp === "bezier" ? clamp(a.easeOut, 0, 1) : 0;
  const inI = clamp(b.easeIn, 0, 1);
  if (outI === 0 && inI === 0) return u;
  return cubicBezier(outI, 0, 1 - inI, 1)(u);
}

export function isVec2(v: ParamValue): v is Vec2 {
  return Array.isArray(v);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const p = (x: number): string => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

export function lerpValue<T extends ParamValue>(a: T, b: T, t: number): T {
  if (typeof a === "number" && typeof b === "number") return (a + (b - a) * t) as T;
  if (isVec2(a) && isVec2(b)) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as T;
  if (typeof a === "string" && typeof b === "string" && a.startsWith("#") && b.startsWith("#")) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return rgbToHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t) as T;
  }
  return (t < 1 ? a : b) as T;
}

export function sortKeys<T extends ParamValue>(keys: Keyframe<T>[]): Keyframe<T>[] {
  return [...keys].sort((x, y) => x.time - y.time);
}

/** Value of an animatable property at layer-local time t. */
export function valueAt<T extends ParamValue>(prop: AnimProp<T>, t: number): T {
  const k = prop.keyframes;
  if (k.length === 0) return prop.value;
  const keys = sortKeys(k);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (t <= first.time) return first.value;
  if (t >= last.time) return last.value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.time) {
      const a = keys[i - 1];
      const span = b.time - a.time;
      if (span <= 1e-9) return b.value;
      const u = (t - a.time) / span;
      return lerpValue(a.value, b.value, easeBetween(a as Keyframe, b as Keyframe, u));
    }
  }
  return last.value;
}

/** Numeric magnitude for graphs (Vec2 uses length of the vector). */
export function scalarOf(v: ParamValue): number {
  if (typeof v === "number") return v;
  if (isVec2(v)) return Math.hypot(v[0], v[1]);
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

/** Approximate speed (units per second) at time t, used by the speed graph. */
export function speedAt(prop: AnimProp, t: number, dt = 1 / 120): number {
  const a = valueAt(prop, t - dt);
  const b = valueAt(prop, t + dt);
  if (typeof a === "number" && typeof b === "number") return (b - a) / (2 * dt);
  if (isVec2(a) && isVec2(b)) return Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * dt);
  return 0;
}

export function makeKey<T extends ParamValue>(time: number, value: T, interp: Keyframe["interp"] = "linear"): Keyframe<T> {
  return { id: uid("k"), time, value, interp, easeIn: 0, easeOut: 0 };
}

export function anim<T extends ParamValue>(value: T): AnimProp<T> {
  return { value, keyframes: [] };
}
