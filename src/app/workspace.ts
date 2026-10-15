import type { DockviewApi } from "dockview-react";
import { backend } from "../lib/backend";
import { t } from "../lib/i18n";

export const PANELS = {
  project: "Project",
  composition: "Composition",
  timeline: "Timeline",
  effectControls: "Effect Controls",
  effects: "Effects & Presets",
  character: "Character",
  info: "Info",
  preview: "Preview",
  renderQueue: "Render Queue",
  history: "History",
  ai: "AI Assistant",
} as const;
export type PanelId = keyof typeof PANELS;

export type WorkspaceName = "Default" | "Animation" | "Effects" | "Minimal";
export const BUILTIN_WORKSPACES: WorkspaceName[] = ["Default", "Animation", "Effects", "Minimal"];

let api: DockviewApi | null = null;
let current: string = "Default";
let saveTimer = 0;

export function setDockApi(a: DockviewApi | null): void {
  api = a;
}
export function dockApi(): DockviewApi | null {
  return api;
}
export function currentWorkspace(): string {
  return current;
}

function add(id: PanelId, position?: Parameters<DockviewApi["addPanel"]>[0]["position"], extra: { initialWidth?: number; initialHeight?: number; inactive?: boolean } = {}): void {
  if (!api || api.getPanel(id)) return;
  api.addPanel({ id, component: id, title: t(PANELS[id]), position, ...extra });
}

export function buildLayout(name: string): void {
  if (!api) return;
  api.clear();
  current = name;
  switch (name) {
    case "Animation":
      add("composition");
      add("timeline", { direction: "below" }, { initialHeight: 420 });
      add("effectControls", { direction: "right", referencePanel: "composition" }, { initialWidth: 340 });
      add("character", { direction: "within", referencePanel: "effectControls" }, { inactive: true });
      add("project", { direction: "left", referencePanel: "composition" }, { initialWidth: 260 });
      add("preview", { direction: "below", referencePanel: "effectControls" }, { initialHeight: 140 });
      add("history", { direction: "within", referencePanel: "timeline" }, { inactive: true });
      break;
    case "Effects":
      add("composition");
      add("timeline", { direction: "below" }, { initialHeight: 300 });
      add("effects", { direction: "left", referencePanel: "composition" }, { initialWidth: 280 });
      add("effectControls", { direction: "right", referencePanel: "composition" }, { initialWidth: 360 });
      add("project", { direction: "within", referencePanel: "effects" }, { inactive: true });
      add("info", { direction: "below", referencePanel: "effectControls" }, { initialHeight: 160 });
      break;
    case "Minimal":
      add("composition");
      add("timeline", { direction: "below" }, { initialHeight: 280 });
      break;
    default:
      add("composition");
      add("timeline", { direction: "below" }, { initialHeight: 320 });
      add("project", { direction: "left", referencePanel: "composition" }, { initialWidth: 290 });
      add("effectControls", { direction: "within", referencePanel: "project" }, { inactive: true });
      add("info", { direction: "right", referencePanel: "composition" }, { initialWidth: 310 });
      add("ai", { direction: "within", referencePanel: "info" }, { inactive: true });
      add("preview", { direction: "below", referencePanel: "info" }, { initialHeight: 150 });
      add("effects", { direction: "below", referencePanel: "preview" });
      add("character", { direction: "within", referencePanel: "effects" }, { inactive: true });
      add("renderQueue", { direction: "within", referencePanel: "timeline" }, { inactive: true });
      add("history", { direction: "within", referencePanel: "timeline" }, { inactive: true });
      break;
  }
  api.getPanel("composition")?.api.setActive();
  api.getPanel("timeline")?.api.setActive();
}

export function openPanel(id: PanelId): void {
  if (!api) return;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  add(id, { direction: "right", referencePanel: "composition" }, { initialWidth: 320 });
}

export function toggleMaximize(): void {
  if (!api) return;
  if (api.hasMaximizedGroup()) {
    api.exitMaximizedGroup();
    return;
  }
  const p = api.activePanel;
  if (p) api.maximizeGroup(p);
}

// ---------------- persistence ----------------
interface SavedWorkspaces {
  current: string;
  layouts: Record<string, unknown>;
}

async function readSaved(): Promise<SavedWorkspaces> {
  try {
    const raw = await backend.appDataRead("workspaces.json");
    if (raw) return JSON.parse(raw) as SavedWorkspaces;
  } catch {
    /* ignore corrupt file */
  }
  return { current: "Default", layouts: {} };
}

export async function restoreLayout(): Promise<void> {
  if (!api) return;
  const saved = await readSaved();
  const layout = saved.layouts[`__last__`] ?? saved.layouts[saved.current];
  current = saved.current;
  if (layout) {
    try {
      api.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
      return;
    } catch {
      /* fall back to the built-in layout */
    }
  }
  buildLayout(saved.current in saved.layouts || BUILTIN_WORKSPACES.includes(saved.current as WorkspaceName) ? saved.current : "Default");
}

export function scheduleLayoutSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persistLayout("__last__"), 400);
}

async function persistLayout(key: string): Promise<void> {
  if (!api) return;
  const saved = await readSaved();
  saved.layouts[key] = api.toJSON();
  saved.current = current;
  await backend.appDataWrite("workspaces.json", JSON.stringify(saved));
}

export async function saveWorkspaceAs(name: string): Promise<void> {
  current = name;
  await persistLayout(name);
}

export async function switchWorkspace(name: string): Promise<void> {
  if (!api) return;
  const saved = await readSaved();
  const layout = saved.layouts[name];
  current = name;
  if (layout && !BUILTIN_WORKSPACES.includes(name as WorkspaceName)) {
    api.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
  } else if (layout) {
    api.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
  } else buildLayout(name);
  scheduleLayoutSave();
}

export async function resetWorkspace(): Promise<void> {
  const saved = await readSaved();
  delete saved.layouts[current];
  delete saved.layouts.__last__;
  await backend.appDataWrite("workspaces.json", JSON.stringify(saved));
  buildLayout(BUILTIN_WORKSPACES.includes(current as WorkspaceName) ? current : "Default");
}

export async function customWorkspaces(): Promise<string[]> {
  const saved = await readSaved();
  return Object.keys(saved.layouts).filter((k) => k !== "__last__" && !BUILTIN_WORKSPACES.includes(k as WorkspaceName));
}
