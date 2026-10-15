import { create } from "zustand";
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import { createProject } from "../engine/factory";
import type { AnimProp, Composition, Layer, Project } from "../engine/types";

enablePatches();

export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  id: number;
  label: string;
  patches: Patch[];
  inverse: Patch[];
  gesture: string | null;
  at: number;
}

export interface KeySelection {
  layerId: string;
  path: string;
  keyId: string;
}

export interface ProjectState {
  project: Project;
  filePath: string | null;
  dirty: boolean;
  /** increments on every project mutation; renderers and caches watch this */
  revision: number;
  past: HistoryEntry[];
  future: HistoryEntry[];
  gesture: string | null;
  currentTime: number;
  selectedLayerIds: string[];
  selectedKeys: KeySelection[];
  execute: (label: string, recipe: (draft: Draft<Project>) => void) => void;
  beginGesture: (key: string) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  jumpToHistory: (pastLength: number) => void;
  load: (project: Project, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
  setTime: (t: number) => void;
  selectLayers: (ids: string[]) => void;
  selectKeys: (keys: KeySelection[]) => void;
}

let entryId = 0;

export const useProject = create<ProjectState>()((set, get) => ({
  project: createProject(),
  filePath: null,
  dirty: false,
  revision: 0,
  past: [],
  future: [],
  gesture: null,
  currentTime: 0,
  selectedLayerIds: [],
  selectedKeys: [],

  execute: (label, recipe) => {
    const s = get();
    const [next, patches, inverse] = produceWithPatches(s.project, recipe);
    if (patches.length === 0) return;
    const last = s.past[s.past.length - 1];
    let past: HistoryEntry[];
    if (s.gesture && last && last.gesture === s.gesture) {
      // merge continuous drags into one undo step
      past = [...s.past.slice(0, -1), { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: Date.now() }];
    } else {
      past = [...s.past, { id: ++entryId, label, patches, inverse, gesture: s.gesture, at: Date.now() }];
      if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
    }
    set({ project: next, past, future: [], dirty: true, revision: s.revision + 1 });
  },

  beginGesture: (key) => set({ gesture: `${key}#${++entryId}` }),
  endGesture: () => set({ gesture: null }),

  undo: () => {
    const s = get();
    const e = s.past[s.past.length - 1];
    if (!e) return;
    set({
      project: applyPatches(s.project, e.inverse),
      past: s.past.slice(0, -1),
      future: [e, ...s.future],
      dirty: true,
      revision: s.revision + 1,
      gesture: null,
    });
  },

  redo: () => {
    const s = get();
    const e = s.future[0];
    if (!e) return;
    set({
      project: applyPatches(s.project, e.patches),
      past: [...s.past, e],
      future: s.future.slice(1),
      dirty: true,
      revision: s.revision + 1,
      gesture: null,
    });
  },

  jumpToHistory: (pastLength) => {
    const s = get();
    let guard = 0;
    while (get().past.length > pastLength && guard++ < 1000) get().undo();
    while (get().past.length < pastLength && get().future.length > 0 && guard++ < 1000) get().redo();
    if (s.past.length === pastLength) return;
  },

  load: (project, filePath) =>
    set((s) => ({
      project,
      filePath,
      dirty: false,
      past: [],
      future: [],
      revision: s.revision + 1,
      currentTime: 0,
      selectedLayerIds: [],
      selectedKeys: [],
    })),

  markSaved: (filePath) => set({ filePath, dirty: false }),

  setTime: (t) => {
    const comp = activeComp(get().project);
    const max = comp ? comp.duration : 0;
    const fps = comp?.fps ?? 30;
    const snapped = Math.round(Math.min(Math.max(0, t), Math.max(0, max - 1 / fps)) * fps) / fps;
    if (snapped !== get().currentTime) set({ currentTime: snapped });
  },

  selectLayers: (ids) => set({ selectedLayerIds: ids }),
  selectKeys: (keys) => set({ selectedKeys: keys }),
}));

export function activeComp(p: Project): Composition | undefined {
  return p.compositions.find((c) => c.id === p.activeCompId) ?? p.compositions[0];
}

export function findLayer(p: Project, layerId: string): Layer | undefined {
  for (const c of p.compositions) {
    const l = c.layers.find((x) => x.id === layerId);
    if (l) return l;
  }
  return undefined;
}

/** Property addressing used by timeline, effect controls, commands and the AI. */
export function getProp(layer: Layer, path: string): AnimProp | undefined {
  if (path.startsWith("transform.")) {
    const k = path.slice(10) as keyof Layer["transform"];
    return layer.transform[k] as AnimProp | undefined;
  }
  if (path === "shape.size") return layer.shape?.size as AnimProp | undefined;
  if (path.startsWith("fx.")) {
    const [, fxId, key] = path.split(".");
    return layer.effects.find((e) => e.id === fxId)?.params[key];
  }
  return undefined;
}

export function propLabel(layer: Layer, path: string): string {
  const names: Record<string, string> = {
    "transform.anchor": "Anchor Point",
    "transform.position": "Position",
    "transform.scale": "Scale",
    "transform.rotation": "Rotation",
    "transform.opacity": "Opacity",
    "shape.size": "Size",
  };
  if (names[path]) return names[path];
  if (path.startsWith("fx.")) {
    const [, fxId, key] = path.split(".");
    const fx = layer.effects.find((e) => e.id === fxId);
    return fx ? `${key}` : path;
  }
  return path;
}

export const TRANSFORM_PATHS = ["transform.anchor", "transform.position", "transform.scale", "transform.rotation", "transform.opacity"] as const;
