import { create } from "zustand";
import { uid } from "../engine/interpolation";

export type Tool = "select" | "anchor" | "hand" | "rect" | "ellipse" | "polygon" | "pen" | "text" | "maskRect" | "maskEllipse";
export type ViewerRes = 1 | 0.5 | 0.25;
export type Dialog = null | "newComp" | "compSettings" | "preferences" | "about" | "recovery";

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "error" | "success";
}

export type ExportFormat = "h264" | "h265" | "prores422" | "prores4444" | "vp9" | "gif" | "png";

export interface RenderJob {
  id: string;
  compId: string;
  compName: string;
  format: ExportFormat;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  range: [number, number];
  quality: number;
  includeAudio: boolean;
  openFolder: boolean;
  status: "queued" | "rendering" | "encoding" | "done" | "failed" | "canceled";
  progress: number;
  etaSeconds: number | null;
  message: string;
  startedAt: number | null;
}

interface UiState {
  tool: Tool;
  playing: boolean;
  loop: boolean;
  zoom: number;
  fitView: boolean;
  pan: [number, number];
  res: ViewerRes;
  transparencyGrid: boolean;
  safeGuides: boolean;
  dialog: Dialog;
  startScreen: boolean;
  expanded: Record<string, boolean>;
  revealPaths: Record<string, string[] | undefined>;
  graphEditor: boolean;
  graphMode: "value" | "speed";
  snapping: boolean;
  timelineZoom: number;
  jobs: RenderJob[];
  toasts: Toast[];
  cachedFrames: Set<number>;
  fps: number;
  editingTextLayerId: string | null;
  penPoints: [number, number][];
  cursor: [number, number] | null;
  renderMs: number;
  set: (p: Partial<UiState>) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: string) => void;
  toggleExpanded: (layerId: string) => void;
  addJob: (job: Omit<RenderJob, "id" | "status" | "progress" | "etaSeconds" | "message" | "startedAt">) => void;
  updateJob: (id: string, patch: Partial<RenderJob>) => void;
  removeJob: (id: string) => void;
}

export const useUi = create<UiState>()((set, get) => ({
  tool: "select",
  playing: false,
  loop: true,
  zoom: 0.5,
  fitView: true,
  pan: [0, 0],
  res: 1,
  transparencyGrid: false,
  safeGuides: false,
  dialog: null,
  startScreen: true,
  expanded: {},
  revealPaths: {},
  graphEditor: false,
  graphMode: "value",
  snapping: true,
  timelineZoom: 1,
  jobs: [],
  toasts: [],
  cachedFrames: new Set<number>(),
  fps: 0,
  editingTextLayerId: null,
  penPoints: [],
  cursor: null,
  renderMs: 0,
  set: (p) => set(p),
  toast: (text, kind = "info") => {
    const t: Toast = { id: uid("toast"), text, kind };
    set({ toasts: [...get().toasts, t] });
    window.setTimeout(() => get().dismiss(t.id), kind === "error" ? 7000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  toggleExpanded: (layerId) => set({ expanded: { ...get().expanded, [layerId]: !get().expanded[layerId] } }),
  addJob: (job) =>
    set({
      jobs: [
        ...get().jobs,
        { ...job, id: uid("job"), status: "queued", progress: 0, etaSeconds: null, message: "Queued", startedAt: null },
      ],
    }),
  updateJob: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
  removeJob: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
}));
