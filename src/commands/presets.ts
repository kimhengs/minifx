// Animation presets: write keyframes onto selected layers starting at the CTI.
import { makeKey, valueAt } from "../engine/interpolation";
import type { Keyframe, Layer, ParamValue, Vec2 } from "../engine/types";
import { localTime } from "../engine/evaluate";
import { activeComp, useProject } from "../store/projectStore";
import { updateLayer } from "./index";

export interface Preset {
  id: string;
  name: string;
  apply: (l: Layer, t: number) => Partial<Record<"position" | "scale" | "rotation" | "opacity", Keyframe[]>>;
}

function eased<T extends ParamValue>(time: number, value: T): Keyframe<T> {
  const k = makeKey(time, value, "bezier");
  k.easeIn = 0.4;
  k.easeOut = 0.4;
  return k;
}

export const PRESETS: Preset[] = [
  { id: "fadeIn", name: "Fade In (0.5s)", apply: (l, t) => ({ opacity: [eased(t, 0), eased(t + 0.5, valueAt(l.transform.opacity, t) || 100)] }) },
  { id: "fadeOut", name: "Fade Out (0.5s)", apply: (l, t) => ({ opacity: [eased(t, valueAt(l.transform.opacity, t) || 100), eased(t + 0.5, 0)] }) },
  {
    id: "popIn",
    name: "Pop In (scale overshoot)",
    apply: (l, t) => {
      const s = valueAt(l.transform.scale, t);
      return { scale: [eased(t, [0, 0] as Vec2), eased(t + 0.25, [s[0] * 1.12, s[1] * 1.12] as Vec2), eased(t + 0.45, s)] };
    },
  },
  {
    id: "slideLeft",
    name: "Slide In from Left",
    apply: (l, t) => {
      const p = valueAt(l.transform.position, t);
      return { position: [eased(t, [p[0] - 600, p[1]] as Vec2), eased(t + 0.6, p)] };
    },
  },
  {
    id: "riseUp",
    name: "Rise Up + Fade",
    apply: (l, t) => {
      const p = valueAt(l.transform.position, t);
      return { position: [eased(t, [p[0], p[1] + 120] as Vec2), eased(t + 0.7, p)], opacity: [eased(t, 0), eased(t + 0.5, 100)] };
    },
  },
  { id: "spin", name: "Spin 360° (2s)", apply: (_l, t) => ({ rotation: [makeKey(t, 0), makeKey(t + 2, 360)] }) },
  {
    id: "kenBurns",
    name: "Ken Burns (slow zoom 5s)",
    apply: (l, t) => {
      const s = valueAt(l.transform.scale, t);
      return { scale: [makeKey(t, s), makeKey(t + 5, [s[0] * 1.15, s[1] * 1.15] as Vec2)] };
    },
  },
  {
    id: "wiggle",
    name: "Wiggle (shake 1s)",
    apply: (l, t) => {
      const p = valueAt(l.transform.position, t);
      const keys: Keyframe<Vec2>[] = [];
      for (let i = 0; i <= 10; i++) keys.push(makeKey(t + i * 0.1, [p[0] + (i % 2 ? 14 : -14) * (1 - i / 10), p[1] + (i % 3 ? 8 : -8) * (1 - i / 10)] as Vec2));
      return { position: keys };
    },
  },
];

export function applyPreset(presetId: string, layerIds?: string[]): number {
  const s = useProject.getState();
  const comp = activeComp(s.project);
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!comp || !preset) return 0;
  const ids = layerIds ?? s.selectedLayerIds;
  let n = 0;
  for (const id of ids) {
    const l = comp.layers.find((x) => x.id === id);
    if (!l) continue;
    const lt = localTime(l, s.currentTime);
    const keys = preset.apply(l, lt);
    updateLayer(id, preset.name, (dl) => {
      for (const [prop, list] of Object.entries(keys) as [keyof typeof keys, Keyframe[]][]) {
        const ap = dl.transform[prop];
        const start = list[0]?.time ?? 0;
        const end = list[list.length - 1]?.time ?? 0;
        ap.keyframes = [...ap.keyframes.filter((k) => k.time < start - 1e-3 || k.time > end + 1e-3), ...list] as typeof ap.keyframes;
      }
    });
    n++;
  }
  return n;
}
