import { anim, uid } from "./interpolation";
import type { AnimProp, Effect, ParamValue, Vec2 } from "./types";

export type ParamKind = "number" | "color" | "checkbox" | "select" | "point";

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface EffectDef {
  type: string;
  name: string;
  category: "Blur & Sharpen" | "Color Correction" | "Stylize" | "Generate" | "Distort" | "Perspective";
  params: ParamDef[];
}

export const EFFECTS: EffectDef[] = [
  {
    type: "gaussianBlur",
    name: "Gaussian Blur",
    category: "Blur & Sharpen",
    params: [
      { key: "blurriness", label: "Blurriness", kind: "number", default: 10, min: 0, max: 200, step: 0.5 },
      { key: "quality", label: "Quality", kind: "number", default: 4, min: 1, max: 10, step: 1 },
    ],
  },
  {
    type: "fastBoxBlur",
    name: "Fast Box Blur",
    category: "Blur & Sharpen",
    params: [{ key: "radius", label: "Blur Radius", kind: "number", default: 8, min: 0, max: 200, step: 0.5 }],
  },
  {
    type: "glow",
    name: "Glow",
    category: "Stylize",
    params: [
      { key: "radius", label: "Glow Radius", kind: "number", default: 12, min: 1, max: 40, step: 1 },
      { key: "intensity", label: "Glow Intensity", kind: "number", default: 2, min: 0, max: 10, step: 0.1 },
      { key: "color", label: "Glow Color", kind: "color", default: "#4fd1e8" },
    ],
  },
  {
    type: "dropShadow",
    name: "Drop Shadow",
    category: "Perspective",
    params: [
      { key: "color", label: "Shadow Color", kind: "color", default: "#000000" },
      { key: "opacity", label: "Opacity", kind: "number", default: 50, min: 0, max: 100, step: 1 },
      { key: "direction", label: "Direction", kind: "number", default: 135, min: 0, max: 360, step: 1 },
      { key: "distance", label: "Distance", kind: "number", default: 10, min: 0, max: 200, step: 1 },
      { key: "softness", label: "Softness", kind: "number", default: 6, min: 0, max: 50, step: 0.5 },
    ],
  },
  {
    type: "brightnessContrast",
    name: "Brightness & Contrast",
    category: "Color Correction",
    params: [
      { key: "brightness", label: "Brightness", kind: "number", default: 0, min: -100, max: 100, step: 1 },
      { key: "contrast", label: "Contrast", kind: "number", default: 0, min: -100, max: 100, step: 1 },
    ],
  },
  {
    type: "hueSaturation",
    name: "Hue/Saturation",
    category: "Color Correction",
    params: [
      { key: "hue", label: "Master Hue", kind: "number", default: 0, min: -180, max: 180, step: 1 },
      { key: "saturation", label: "Master Saturation", kind: "number", default: 0, min: -100, max: 100, step: 1 },
      { key: "lightness", label: "Master Lightness", kind: "number", default: 0, min: -100, max: 100, step: 1 },
    ],
  },
  {
    type: "curves",
    name: "Curves",
    category: "Color Correction",
    params: [
      { key: "gamma", label: "Gamma (midtones)", kind: "number", default: 1, min: 0.2, max: 3, step: 0.01 },
      { key: "red", label: "Red", kind: "number", default: 1, min: 0, max: 2, step: 0.01 },
      { key: "green", label: "Green", kind: "number", default: 1, min: 0, max: 2, step: 0.01 },
      { key: "blue", label: "Blue", kind: "number", default: 1, min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    type: "fill",
    name: "Fill",
    category: "Generate",
    params: [
      { key: "color", label: "Color", kind: "color", default: "#ff0000" },
      { key: "opacity", label: "Opacity", kind: "number", default: 100, min: 0, max: 100, step: 1 },
    ],
  },
  {
    type: "tint",
    name: "Tint",
    category: "Color Correction",
    params: [
      { key: "mapWhite", label: "Map White To", kind: "color", default: "#ffd28a" },
      { key: "amount", label: "Amount to Tint", kind: "number", default: 100, min: 0, max: 100, step: 1 },
    ],
  },
  {
    type: "displacement",
    name: "Displacement (Turbulent)",
    category: "Distort",
    params: [
      { key: "amount", label: "Amount", kind: "number", default: 20, min: 0, max: 200, step: 1 },
      { key: "evolve", label: "Evolution", kind: "number", default: 0, min: -1000, max: 1000, step: 1 },
    ],
  },
  {
    type: "gradientRamp",
    name: "Gradient Ramp",
    category: "Generate",
    params: [
      { key: "startColor", label: "Start Color", kind: "color", default: "#000000" },
      { key: "endColor", label: "End Color", kind: "color", default: "#ffffff" },
      { key: "angle", label: "Angle", kind: "number", default: 90, min: 0, max: 360, step: 1 },
      { key: "blend", label: "Blend With Original", kind: "number", default: 0, min: 0, max: 100, step: 1 },
    ],
  },
  {
    type: "invert",
    name: "Invert",
    category: "Color Correction",
    params: [{ key: "enabled", label: "Invert", kind: "checkbox", default: true }],
  },
];

export function effectDef(type: string): EffectDef | undefined {
  return EFFECTS.find((e) => e.type === type);
}

export function createEffect(type: string): Effect {
  const def = effectDef(type);
  if (!def) throw new Error(`Unknown effect ${type}`);
  const params: Record<string, AnimProp> = {};
  for (const p of def.params) {
    const v: ParamValue = Array.isArray(p.default) ? ([...p.default] as Vec2) : p.default;
    params[p.key] = anim(v) as AnimProp;
  }
  return { id: uid("fx"), type, enabled: true, params };
}
