// Single registry of user actions: used by the menu bar, keyboard shortcuts,
// the shortcut editor and the AI assistant.
import * as cmd from "../commands";
import { localTime } from "../engine/evaluate";
import { queueActiveComp, runQueue } from "../lib/exporter";
import { confirmDiscard, importDialog, newProject, openProject, saveProject } from "../lib/projectIO";
import { activeComp, getProp, TRANSFORM_PATHS, useProject } from "../store/projectStore";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { backend } from "../lib/backend";
import { shuttle, stepFrames, stop, togglePlay } from "./playback";
import { buildLayout, openPanel, resetWorkspace, saveWorkspaceAs, toggleMaximize, type PanelId, PANELS } from "./workspace";
import { ramPreview } from "./ramPreview";

export interface Action {
  id: string;
  label: string;
  menu: "File" | "Edit" | "Composition" | "Layer" | "Effect" | "Window" | "Help" | "Time" | "Tools" | "View";
  keys?: string;
  run: () => void;
  enabled?: () => boolean;
}

const P = () => useProject.getState();
const U = () => useUi.getState();
const sel = (): string[] => P().selectedLayerIds;
const hasComp = (): boolean => !!activeComp(P().project) && !U().startScreen;
const hasSel = (): boolean => hasComp() && sel().length > 0;

function revealProps(paths: string[] | "keyed"): void {
  const ids = sel().length ? sel() : (activeComp(P().project)?.layers.map((l) => l.id) ?? []);
  const comp = activeComp(P().project);
  if (!comp) return;
  const reveal: Record<string, string[] | undefined> = { ...U().revealPaths };
  const expanded: Record<string, boolean> = { ...U().expanded };
  for (const id of ids) {
    const l = comp.layers.find((x) => x.id === id);
    if (!l) continue;
    let list: string[];
    if (paths === "keyed") {
      const all = [...TRANSFORM_PATHS, ...(l.shape ? ["shape.size"] : []), ...l.effects.flatMap((fx) => Object.keys(fx.params).map((k) => `fx.${fx.id}.${k}`))];
      list = all.filter((p) => (getProp(l, p)?.keyframes.length ?? 0) > 0);
    } else list = paths;
    const same = JSON.stringify(reveal[id]) === JSON.stringify(list);
    reveal[id] = same ? undefined : list;
    expanded[id] = !same && list.length > 0;
  }
  U().set({ revealPaths: reveal, expanded });
}

function goToKey(dir: -1 | 1): void {
  const comp = activeComp(P().project);
  if (!comp) return;
  const t = P().currentTime;
  const times: number[] = [];
  const layers = sel().length ? comp.layers.filter((l) => sel().includes(l.id)) : comp.layers;
  for (const l of layers) {
    for (const p of [...TRANSFORM_PATHS, "shape.size", ...l.effects.flatMap((fx) => Object.keys(fx.params).map((k) => `fx.${fx.id}.${k}`))]) {
      for (const k of getProp(l, p)?.keyframes ?? []) times.push(k.time + l.start);
    }
  }
  for (const m of comp.markers) times.push(m.time);
  const cand = times.filter((x) => (dir > 0 ? x > t + 1e-4 : x < t - 1e-4)).sort((a, b) => a - b);
  const next = dir > 0 ? cand[0] : cand[cand.length - 1];
  if (next !== undefined) P().setTime(next);
}

function addKeysToSelection(): void {
  for (const id of sel()) {
    const comp = activeComp(P().project);
    const l = comp?.layers.find((x) => x.id === id);
    if (!l) continue;
    const animated = TRANSFORM_PATHS.filter((p) => (getProp(l, p)?.keyframes.length ?? 0) > 0);
    for (const p of animated.length ? animated : ["transform.position"]) {
      if (!animated.length) cmd.toggleStopwatch(id, p);
      else cmd.addKeyframeAtTime(id, p);
    }
  }
}

export const ACTIONS: Action[] = [
  // File
  { id: "file.new", label: "New Project", menu: "File", keys: "Ctrl+Alt+N", run: () => void confirmDiscard().then((ok) => ok && (newProject(), U().set({ dialog: "newComp" }))) },
  { id: "file.open", label: "Open Project…", menu: "File", keys: "Ctrl+O", run: () => void confirmDiscard().then((ok) => ok && void openProject()) },
  { id: "file.save", label: "Save", menu: "File", keys: "Ctrl+S", run: () => void saveProject(false), enabled: hasComp },
  { id: "file.saveAs", label: "Save As…", menu: "File", keys: "Ctrl+Shift+S", run: () => void saveProject(true), enabled: hasComp },
  { id: "file.import", label: "Import File…", menu: "File", keys: "Ctrl+I", run: () => void importDialog(), enabled: hasComp },
  { id: "file.close", label: "Close Project", menu: "File", keys: "Ctrl+W", run: () => void confirmDiscard().then((ok) => ok && U().set({ startScreen: true })), enabled: hasComp },
  { id: "file.exit", label: "Exit", menu: "File", keys: "Ctrl+Q", run: () => void backend.windowAction("close") },
  // Edit
  { id: "edit.undo", label: "Undo", menu: "Edit", keys: "Ctrl+Z", run: () => P().undo(), enabled: () => P().past.length > 0 },
  { id: "edit.redo", label: "Redo", menu: "Edit", keys: "Ctrl+Shift+Z", run: () => P().redo(), enabled: () => P().future.length > 0 },
  {
    id: "edit.copy",
    label: "Copy Keyframes",
    menu: "Edit",
    keys: "Ctrl+C",
    run: () => {
      const n = cmd.copySelectedKeys();
      if (n) U().toast(`Copied ${n} keyframe${n > 1 ? "s" : ""}`);
    },
    enabled: () => P().selectedKeys.length > 0,
  },
  { id: "edit.paste", label: "Paste Keyframes", menu: "Edit", keys: "Ctrl+V", run: () => sel()[0] && cmd.pasteKeys(sel()[0]), enabled: hasSel },
  { id: "edit.duplicate", label: "Duplicate", menu: "Edit", keys: "Ctrl+D", run: () => cmd.duplicateLayers(sel()), enabled: hasSel },
  {
    id: "edit.delete",
    label: "Delete",
    menu: "Edit",
    keys: "Delete",
    run: () => (P().selectedKeys.length ? cmd.deleteSelectedKeys() : cmd.deleteLayers(sel())),
    enabled: () => hasSel() || P().selectedKeys.length > 0,
  },
  { id: "edit.selectAll", label: "Select All Layers", menu: "Edit", keys: "Ctrl+A", run: () => P().selectLayers(activeComp(P().project)?.layers.map((l) => l.id) ?? []), enabled: hasComp },
  { id: "edit.deselect", label: "Deselect All", menu: "Edit", keys: "Ctrl+Shift+A", run: () => (P().selectLayers([]), P().selectKeys([])) },
  { id: "edit.preferences", label: "Preferences…", menu: "Edit", keys: "Ctrl+,", run: () => U().set({ dialog: "preferences" }) },
  // Composition
  { id: "comp.new", label: "New Composition…", menu: "Composition", keys: "Ctrl+N", run: () => U().set({ dialog: "newComp" }) },
  { id: "comp.settings", label: "Composition Settings…", menu: "Composition", keys: "Ctrl+K", run: () => U().set({ dialog: "compSettings" }), enabled: hasComp },
  {
    id: "comp.addToQueue",
    label: "Add to Render Queue",
    menu: "Composition",
    keys: "Ctrl+M",
    run: () => {
      queueActiveComp();
      openPanel("renderQueue");
    },
    enabled: hasComp,
  },
  { id: "comp.render", label: "Render Queue Now", menu: "Composition", keys: "Ctrl+Alt+M", run: () => void runQueue() },
  { id: "comp.workStart", label: "Set Work Area Start", menu: "Composition", keys: "B", run: () => cmd.setWorkArea(P().currentTime, activeComp(P().project)?.workArea[1] ?? 0), enabled: hasComp },
  { id: "comp.workEnd", label: "Set Work Area End", menu: "Composition", keys: "N", run: () => cmd.setWorkArea(activeComp(P().project)?.workArea[0] ?? 0, P().currentTime + 1 / (activeComp(P().project)?.fps ?? 30)), enabled: hasComp },
  { id: "comp.marker", label: "Add Marker", menu: "Composition", keys: "Shift+8", run: () => cmd.addMarker(P().currentTime), enabled: hasComp },
  { id: "comp.ramPreview", label: "RAM Preview", menu: "Composition", keys: "Ctrl+Space", run: () => void ramPreview(), enabled: hasComp },
  // Layer
  { id: "layer.solid", label: "New Solid", menu: "Layer", keys: "Ctrl+Y", run: () => cmd.addLayer("solid"), enabled: hasComp },
  { id: "layer.text", label: "New Text", menu: "Layer", keys: "Ctrl+Alt+Shift+T", run: () => cmd.addLayer("text", { text: "Your Text" }), enabled: hasComp },
  { id: "layer.rect", label: "New Shape · Rectangle", menu: "Layer", run: () => cmd.addLayer("shape", { shapeKind: "rect" }), enabled: hasComp },
  { id: "layer.ellipse", label: "New Shape · Ellipse", menu: "Layer", run: () => cmd.addLayer("shape", { shapeKind: "ellipse" }), enabled: hasComp },
  { id: "layer.polygon", label: "New Shape · Polygon", menu: "Layer", run: () => cmd.addLayer("shape", { shapeKind: "polygon" }), enabled: hasComp },
  { id: "layer.null", label: "New Null Object", menu: "Layer", keys: "Ctrl+Alt+Shift+Y", run: () => cmd.addLayer("null"), enabled: hasComp },
  { id: "layer.adjustment", label: "New Adjustment Layer", menu: "Layer", keys: "Ctrl+Alt+Y", run: () => cmd.addLayer("adjustment"), enabled: hasComp },
  { id: "layer.split", label: "Split Layer", menu: "Layer", keys: "Ctrl+Shift+D", run: () => cmd.splitLayers(sel(), P().currentTime), enabled: hasSel },
  { id: "layer.trimIn", label: "Trim In Point to Time", menu: "Layer", keys: "Alt+[", run: () => sel().forEach((id) => cmd.trimLayer(id, "in", P().currentTime)), enabled: hasSel },
  { id: "layer.trimOut", label: "Trim Out Point to Time", menu: "Layer", keys: "Alt+]", run: () => sel().forEach((id) => cmd.trimLayer(id, "out", P().currentTime)), enabled: hasSel },
  {
    id: "layer.forward",
    label: "Bring Layer Forward",
    menu: "Layer",
    keys: "Ctrl+]",
    run: () => {
      const comp = activeComp(P().project);
      for (const id of sel()) cmd.reorderLayer(id, (comp?.layers.findIndex((l) => l.id === id) ?? 0) - 1);
    },
    enabled: hasSel,
  },
  {
    id: "layer.backward",
    label: "Send Layer Backward",
    menu: "Layer",
    keys: "Ctrl+[",
    run: () => {
      const comp = activeComp(P().project);
      for (const id of [...sel()].reverse()) cmd.reorderLayer(id, (comp?.layers.findIndex((l) => l.id === id) ?? 0) + 1);
    },
    enabled: hasSel,
  },
  { id: "layer.maskRect", label: "New Mask · Rectangle", menu: "Layer", run: () => sel().forEach((id) => cmd.addMask(id, "rect")), enabled: hasSel },
  { id: "layer.maskEllipse", label: "New Mask · Ellipse", menu: "Layer", run: () => sel().forEach((id) => cmd.addMask(id, "ellipse")), enabled: hasSel },
  { id: "layer.revealAnchor", label: "Show Anchor Point", menu: "Layer", keys: "A", run: () => revealProps(["transform.anchor"]), enabled: hasComp },
  { id: "layer.revealPosition", label: "Show Position", menu: "Layer", keys: "P", run: () => revealProps(["transform.position"]), enabled: hasComp },
  { id: "layer.revealScale", label: "Show Scale", menu: "Layer", keys: "S", run: () => revealProps(["transform.scale"]), enabled: hasComp },
  { id: "layer.revealRotation", label: "Show Rotation", menu: "Layer", keys: "R", run: () => revealProps(["transform.rotation"]), enabled: hasComp },
  { id: "layer.revealOpacity", label: "Show Opacity", menu: "Layer", keys: "T", run: () => revealProps(["transform.opacity"]), enabled: hasComp },
  { id: "layer.revealKeyed", label: "Show Animated Properties", menu: "Layer", keys: "U", run: () => revealProps("keyed"), enabled: hasComp },
  // Keyframes (Effect menu hosts animation helpers like AE's Animation menu)
  { id: "key.add", label: "Add Keyframe (selected layers)", menu: "Effect", keys: "Alt+Shift+K", run: addKeysToSelection, enabled: hasSel },
  { id: "key.easy", label: "Keyframe Assistant · Easy Ease", menu: "Effect", keys: "F9", run: () => cmd.easyEaseSelected("both"), enabled: () => P().selectedKeys.length > 0 },
  { id: "key.easyIn", label: "Easy Ease In", menu: "Effect", keys: "Shift+F9", run: () => cmd.easyEaseSelected("in"), enabled: () => P().selectedKeys.length > 0 },
  { id: "key.easyOut", label: "Easy Ease Out", menu: "Effect", keys: "Ctrl+Shift+F9", run: () => cmd.easyEaseSelected("out"), enabled: () => P().selectedKeys.length > 0 },
  { id: "key.linear", label: "Interpolation · Linear", menu: "Effect", run: () => cmd.setSelectedInterp("linear"), enabled: () => P().selectedKeys.length > 0 },
  { id: "key.hold", label: "Interpolation · Hold", menu: "Effect", keys: "Ctrl+Alt+H", run: () => cmd.setSelectedInterp("hold"), enabled: () => P().selectedKeys.length > 0 },
  { id: "effect.panel", label: "Effects & Presets…", menu: "Effect", keys: "Ctrl+5", run: () => openPanel("effects") },
  // Time / playback
  { id: "time.play", label: "Play / Stop", menu: "Time", keys: "Space", run: togglePlay, enabled: hasComp },
  { id: "time.home", label: "Go to Start", menu: "Time", keys: "Home", run: () => (stop(), P().setTime(activeComp(P().project)?.workArea[0] ?? 0)) },
  { id: "time.end", label: "Go to End", menu: "Time", keys: "End", run: () => (stop(), P().setTime(activeComp(P().project)?.workArea[1] ?? 0)) },
  { id: "time.prevFrame", label: "Previous Frame", menu: "Time", keys: "PageUp", run: () => stepFrames(-1) },
  { id: "time.nextFrame", label: "Next Frame", menu: "Time", keys: "PageDown", run: () => stepFrames(1) },
  { id: "time.prev10", label: "Back 10 Frames", menu: "Time", keys: "Shift+PageUp", run: () => stepFrames(-10) },
  { id: "time.next10", label: "Forward 10 Frames", menu: "Time", keys: "Shift+PageDown", run: () => stepFrames(10) },
  { id: "time.shuttleBack", label: "Shuttle Reverse (J)", menu: "Time", keys: "J", run: () => shuttle(-1) },
  { id: "time.shuttleStop", label: "Shuttle Stop (K)", menu: "Time", keys: "K", run: () => shuttle(0) },
  { id: "time.shuttleFwd", label: "Shuttle Forward (L)", menu: "Time", keys: "L", run: () => shuttle(1) },
  { id: "time.prevKey", label: "Previous Keyframe / Marker", menu: "Time", keys: "Shift+J", run: () => goToKey(-1) },
  { id: "time.nextKey", label: "Next Keyframe / Marker", menu: "Time", keys: "Shift+K", run: () => goToKey(1) },
  // Tools
  { id: "tool.select", label: "Selection Tool", menu: "Tools", keys: "V", run: () => U().set({ tool: "select" }) },
  { id: "tool.hand", label: "Hand Tool", menu: "Tools", keys: "H", run: () => U().set({ tool: "hand" }) },
  { id: "tool.anchor", label: "Pan Behind (Anchor Point) Tool", menu: "Tools", keys: "Y", run: () => U().set({ tool: "anchor" }) },
  { id: "tool.shape", label: "Shape Tool (cycle)", menu: "Tools", keys: "Q", run: () => U().set({ tool: U().tool === "rect" ? "ellipse" : U().tool === "ellipse" ? "polygon" : "rect" }) },
  { id: "tool.pen", label: "Pen Tool", menu: "Tools", keys: "G", run: () => U().set({ tool: "pen", penPoints: [] }) },
  { id: "tool.text", label: "Type Tool", menu: "Tools", keys: "Ctrl+T", run: () => U().set({ tool: "text" }) },
  { id: "tool.mask", label: "Mask Tool (cycle)", menu: "Tools", keys: "M", run: () => U().set({ tool: U().tool === "maskRect" ? "maskEllipse" : "maskRect" }) },
  // View
  { id: "view.zoomIn", label: "Zoom In", menu: "View", keys: ".", run: () => U().set({ zoom: Math.min(4, U().zoom * 1.25), fitView: false }) },
  { id: "view.zoomOut", label: "Zoom Out", menu: "View", keys: ",", run: () => U().set({ zoom: Math.max(0.05, U().zoom / 1.25), fitView: false }) },
  { id: "view.fit", label: "Fit Composition", menu: "View", keys: "Shift+/", run: () => U().set({ fitView: true, pan: [0, 0] }) },
  { id: "view.full", label: "Resolution · Full", menu: "View", keys: "Ctrl+J", run: () => U().set({ res: 1 }) },
  { id: "view.half", label: "Resolution · Half", menu: "View", keys: "Ctrl+Shift+J", run: () => U().set({ res: 0.5 }) },
  { id: "view.quarter", label: "Resolution · Quarter", menu: "View", keys: "Ctrl+Alt+Shift+J", run: () => U().set({ res: 0.25 }) },
  { id: "view.grid", label: "Toggle Transparency Grid", menu: "View", run: () => U().set({ transparencyGrid: !U().transparencyGrid }) },
  { id: "view.guides", label: "Toggle Title/Action Safe", menu: "View", keys: "'", run: () => U().set({ safeGuides: !U().safeGuides }) },
  // Window
  { id: "win.maximize", label: "Maximize Panel", menu: "Window", keys: "`", run: toggleMaximize },
  { id: "ws.default", label: "Workspace · Default", menu: "Window", keys: "Shift+F10", run: () => buildLayout("Default") },
  { id: "ws.animation", label: "Workspace · Animation", menu: "Window", keys: "Shift+F11", run: () => buildLayout("Animation") },
  { id: "ws.effects", label: "Workspace · Effects", menu: "Window", keys: "Shift+F12", run: () => buildLayout("Effects") },
  { id: "ws.minimal", label: "Workspace · Minimal", menu: "Window", run: () => buildLayout("Minimal") },
  {
    id: "ws.save",
    label: "Save Workspace As…",
    menu: "Window",
    run: () => {
      const name = window.prompt("Workspace name", "My Workspace");
      if (name) void saveWorkspaceAs(name).then(() => U().toast(`Saved workspace “${name}”`, "success"));
    },
  },
  { id: "ws.reset", label: "Reset Workspace", menu: "Window", run: () => void resetWorkspace() },
  ...(Object.keys(PANELS) as PanelId[]).map((id) => ({ id: `panel.${id}`, label: PANELS[id], menu: "Window" as const, run: () => openPanel(id) })),
  { id: "ai.open", label: "AI Assistant", menu: "Window", keys: "Ctrl+/", run: () => openPanel("ai") },
  // Help
  { id: "help.shortcuts", label: "Keyboard Shortcuts…", menu: "Help", keys: "Ctrl+Alt+'", run: () => U().set({ dialog: "preferences" }) },
  { id: "help.updates", label: "Check for Updates…", menu: "Help", run: () => void checkForUpdates() },
  { id: "help.logs", label: "Open Log Folder", menu: "Help", run: () => void backend.revealLogs() },
  { id: "help.about", label: "About MiniFX", menu: "Help", run: () => U().set({ dialog: "about" }) },
];

async function checkForUpdates(): Promise<void> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return U().toast("You're on the latest version.", "success");
    U().toast(`Downloading MiniFX ${update.version}…`);
    await update.downloadAndInstall();
    U().toast("Update installed — restart MiniFX to finish.", "success");
  } catch (e) {
    U().toast(`Updates are not available: ${String(e)}`, "error");
  }
}

export function actionKeys(a: Action): string | undefined {
  const o = useSettings.getState().shortcuts[a.id];
  return o === undefined ? a.keys : o || undefined;
}

export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  if (k === " ") k = "Space";
  else if (k.length === 1) k = k.toUpperCase();
  if (e.code === "Backquote") k = "`";
  if (e.code === "BracketLeft") k = "[";
  if (e.code === "BracketRight") k = "]";
  if (e.code === "Slash") k = "/";
  if (e.code === "Period") k = ".";
  if (e.code === "Comma") k = ",";
  if (e.code === "Quote") k = "'";
  if (e.code.startsWith("Digit")) k = e.code.slice(5);
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return parts.join("+");
  if (k === "Del" || k === "Backspace") k = "Delete";
  parts.push(k);
  return parts.join("+");
}

export function findActionForCombo(combo: string): Action | undefined {
  const norm = (s: string): string => s.toUpperCase();
  return ACTIONS.find((a) => {
    const k = actionKeys(a);
    return k !== undefined && norm(k) === norm(combo);
  });
}

export function runAction(id: string): void {
  const a = ACTIONS.find((x) => x.id === id);
  if (a && (!a.enabled || a.enabled())) a.run();
}

export function layerLocalTime(layerId: string): number {
  const comp = activeComp(P().project);
  const l = comp?.layers.find((x) => x.id === layerId);
  return l ? localTime(l, P().currentTime) : 0;
}
