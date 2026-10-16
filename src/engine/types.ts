// Core project data model. Everything here is plain JSON so it can be saved,
// diffed by immer for undo/redo, and migrated between schema versions.

export type Vec2 = [number, number];
export type ParamValue = number | Vec2 | string | boolean;

/** linear = straight line, bezier = eased with influence, hold = jump at next key */
export type Interp = "linear" | "bezier" | "hold";

export interface Keyframe<T extends ParamValue = ParamValue> {
  id: string;
  /** seconds, relative to layer.start (moves with the layer) */
  time: number;
  value: T;
  /** interpolation leaving this keyframe */
  interp: Interp;
  /** ease influence 0..1 (like After Effects influence %) */
  easeIn: number;
  easeOut: number;
}

export interface AnimProp<T extends ParamValue = ParamValue> {
  value: T;
  keyframes: Keyframe<T>[];
}

export interface Transform {
  anchor: AnimProp<Vec2>;
  position: AnimProp<Vec2>;
  scale: AnimProp<Vec2>;
  rotation: AnimProp<number>;
  opacity: AnimProp<number>;
}
export type TransformKey = keyof Transform;

export type BlendMode = "normal" | "add" | "multiply" | "screen" | "overlay";
export type LayerKind = "video" | "image" | "audio" | "solid" | "text" | "shape" | "null" | "adjustment";

export interface TextData {
  text: string;
  font: string;
  size: number;
  tracking: number;
  leading: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  align: "left" | "center" | "right";
  weight: number;
}

export type ShapeKind = "rect" | "ellipse" | "polygon" | "path";
export interface ShapeData {
  kind: ShapeKind;
  size: AnimProp<Vec2>;
  points: number;
  roundness: number;
  path: Vec2[];
  closed: boolean;
  fill: string;
  fillEnabled: boolean;
  stroke: string;
  strokeWidth: number;
}

export type MaskKind = "rect" | "ellipse" | "path";
export interface Mask {
  id: string;
  name: string;
  kind: MaskKind;
  mode: "add" | "subtract";
  /** rect/ellipse box in layer space: x, y, w, h */
  box: [number, number, number, number];
  path: Vec2[];
  feather: number;
  opacity: number;
  enabled: boolean;
}

export interface Effect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, AnimProp>;
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  /** comp time where source/keyframe time 0 sits */
  start: number;
  inPoint: number;
  outPoint: number;
  visible: boolean;
  audioEnabled: boolean;
  solo: boolean;
  locked: boolean;
  shy: boolean;
  label: number;
  parentId: string | null;
  blend: BlendMode;
  transform: Transform;
  effects: Effect[];
  masks: Mask[];
  sourceId?: string;
  solid?: { color: string; width: number; height: number };
  text?: TextData;
  shape?: ShapeData;
  volume?: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bg: string;
  /** layers[0] is the top-most layer, like After Effects */
  layers: Layer[];
  workArea: [number, number];
  markers: Marker[];
}

export type MediaKind = "video" | "image" | "audio";
export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  /** absolute file path (desktop) or blob: url (browser preview mode) */
  path: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
  size: number;
  thumbnail?: string;
  /** horizontal strip of evenly spaced frames across the whole clip (timeline display) */
  filmstrip?: string;
  filmstripFrames?: number;
  proxyPath?: string;
  /** high-quality H.264 copy, made when the viewer cannot decode the original codec (HEVC, ProRes, 10-bit…) */
  playablePath?: string;
  status: "ready" | "processing" | "offline";
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  compositions: Composition[];
  media: MediaItem[];
  activeCompId: string | null;
  createdAt: string;
  modifiedAt: string;
}
