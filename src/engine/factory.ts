import { anim, uid } from "./interpolation";
import type { Composition, Layer, LayerKind, Mask, MaskKind, MediaItem, Project, ShapeKind, Transform, Vec2 } from "./types";

export const SCHEMA_VERSION = 2;

export function createTransform(anchor: Vec2, position: Vec2): Transform {
  return {
    anchor: anim<Vec2>([anchor[0], anchor[1]]),
    position: anim<Vec2>([position[0], position[1]]),
    scale: anim<Vec2>([100, 100]),
    rotation: anim(0),
    opacity: anim(100),
  };
}

export interface CompSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bg: string;
}

export function createComposition(s: Partial<CompSettings> = {}): Composition {
  const duration = s.duration ?? 10;
  return {
    id: uid("comp"),
    name: s.name ?? "Comp 1",
    width: s.width ?? 1920,
    height: s.height ?? 1080,
    fps: s.fps ?? 30,
    duration,
    bg: s.bg ?? "#000000",
    layers: [],
    workArea: [0, duration],
    markers: [],
  };
}

export function createProject(name = "Untitled Project", comp?: Partial<CompSettings>): Project {
  const c = createComposition(comp);
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid("proj"),
    name,
    compositions: [c],
    media: [],
    activeCompId: c.id,
    createdAt: now,
    modifiedAt: now,
  };
}

const LABEL_COUNT = 8;
const SHAPE_COLORS = ["#4fd1e8", "#f5b13d", "#e5534b", "#46c08a", "#a99beb", "#ffffff"];
let labelCursor = 0;

export interface LayerInit {
  name?: string;
  start?: number;
  duration?: number;
  media?: MediaItem;
  color?: string;
  text?: string;
  shapeKind?: ShapeKind;
  size?: Vec2;
}

export function createLayer(kind: LayerKind, comp: Composition, init: LayerInit = {}): Layer {
  const start = init.start ?? 0;
  const mediaDur = init.media && init.media.kind !== "image" ? init.media.duration : 0;
  const duration = init.duration ?? (mediaDur > 0 ? mediaDur : comp.duration - start);
  const center: Vec2 = [comp.width / 2, comp.height / 2];
  let anchor: Vec2 = [0, 0];
  const base: Layer = {
    id: uid("layer"),
    name: init.name ?? kind[0].toUpperCase() + kind.slice(1),
    kind,
    start,
    inPoint: start,
    outPoint: start + duration,
    visible: true,
    audioEnabled: true,
    solo: false,
    locked: false,
    shy: false,
    label: (labelCursor++ % LABEL_COUNT) + 1,
    parentId: null,
    blend: "normal",
    transform: createTransform([0, 0], center),
    effects: [],
    masks: [],
  };
  switch (kind) {
    case "video":
    case "image":
    case "audio":
      if (init.media) {
        base.sourceId = init.media.id;
        base.name = init.name ?? init.media.name;
        anchor = [init.media.width / 2, init.media.height / 2];
        base.volume = 0;
      }
      break;
    case "solid":
    case "adjustment": {
      const w = init.size?.[0] ?? comp.width;
      const h = init.size?.[1] ?? comp.height;
      base.solid = { color: init.color ?? (kind === "adjustment" ? "#ffffff" : "#2c3e5c"), width: w, height: h };
      anchor = [w / 2, h / 2];
      if (kind === "adjustment") base.name = init.name ?? "Adjustment Layer";
      else base.name = init.name ?? "Solid";
      break;
    }
    case "text":
      base.text = {
        text: init.text ?? "Text",
        font: "Inter",
        size: 96,
        tracking: 0,
        leading: 120,
        fill: init.color ?? "#ffffff",
        stroke: "#000000",
        strokeWidth: 0,
        align: "center",
        weight: 600,
      };
      base.name = init.name ?? (init.text ?? "Text").slice(0, 24);
      anchor = [0, 0];
      break;
    case "shape": {
      const size: Vec2 = init.size ?? [400, 400];
      base.shape = {
        kind: init.shapeKind ?? "rect",
        size: anim<Vec2>(size),
        points: 5,
        roundness: 0,
        path: [],
        closed: true,
        fill: init.color ?? SHAPE_COLORS[labelCursor % SHAPE_COLORS.length],
        fillEnabled: true,
        stroke: "#ffffff",
        strokeWidth: 0,
      };
      base.name = init.name ?? `Shape ${init.shapeKind ?? "rect"}`;
      anchor = [0, 0];
      break;
    }
    case "null":
      base.name = init.name ?? "Null";
      break;
  }
  base.transform.anchor.value = anchor;
  return base;
}

export function createMask(kind: MaskKind, w: number, h: number, n: number): Mask {
  return {
    id: uid("mask"),
    name: `Mask ${n}`,
    kind,
    mode: "add",
    box: [w * 0.15, h * 0.15, w * 0.7, h * 0.7],
    path: [],
    feather: 0,
    opacity: 100,
    enabled: true,
  };
}

export function formatTimecode(t: number, fps: number): string {
  const total = Math.max(0, Math.round(t * fps));
  const f = total % fps;
  const s = Math.floor(total / fps) % 60;
  const m = Math.floor(total / fps / 60) % 60;
  const h = Math.floor(total / fps / 3600);
  const p = (n: number): string => n.toString().padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}
