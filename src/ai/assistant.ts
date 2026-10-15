// MiniFX AI Assistant (offline). Turns a prompt into a reviewable plan of
// editor commands, after auditing the project and the prompt. Everything it
// does goes through the same undoable commands as the UI.
import * as cmd from "../commands";
import { applyPreset, PRESETS } from "../commands/presets";
import { EFFECTS } from "../engine/effects";
import { valueAt } from "../engine/interpolation";
import type { Composition, Layer, Project, Vec2 } from "../engine/types";
import { queueActiveComp, runQueue } from "../lib/exporter";
import { activeComp, useProject } from "../store/projectStore";
import { buildLayout } from "../app/workspace";

export interface PlanStep {
  label: string;
  run: () => void;
}

export interface AuditItem {
  level: "ok" | "warn" | "info";
  text: string;
}

export interface Plan {
  steps: PlanStep[];
  audit: AuditItem[];
  notes: string[];
  understood: boolean;
}

function parseTime(s: string): number | null {
  const clean = s.replace(/\d+\s*[x×]\s*\d+/g, " ");
  const m = clean.match(/(\d{1,2}):(\d{1,2}(?:\.\d+)?)/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const sec = clean.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?|វិនាទី)\b/);
  return sec ? Number(sec[1]) : null;
}

function findLayer(comp: Composition, low: string, selected: string[]): { layer: Layer | null; named: boolean } {
  const quoted = low.match(/["“']([^"”']+)["”']/)?.[1];
  for (const l of comp.layers) {
    const name = l.name.toLowerCase();
    if (quoted && name === quoted) return { layer: l, named: true };
    const words = name.split(/[^a-z0-9ក-៿]+/).filter((w) => w.length >= 4);
    if (words.some((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(low))) return { layer: l, named: true };
  }
  const sel = comp.layers.find((l) => selected.includes(l.id));
  return { layer: sel ?? comp.layers[0] ?? null, named: false };
}

export function audit(project: Project, comp: Composition | undefined): AuditItem[] {
  const out: AuditItem[] = [];
  if (!comp) return [{ level: "warn", text: "No composition open — create one first (Ctrl+N)." }];
  out.push({ level: "info", text: `${comp.name}: ${comp.width}×${comp.height}, ${comp.fps} fps, ${comp.duration}s, ${comp.layers.length} layers` });
  const offline = project.media.filter((m) => m.status === "offline");
  if (offline.length) out.push({ level: "warn", text: `${offline.length} media file(s) offline: ${offline.map((m) => m.name).join(", ")}` });
  const usedIds = new Set(comp.layers.map((l) => l.sourceId).filter(Boolean));
  const unused = project.media.filter((m) => !usedIds.has(m.id));
  if (unused.length) out.push({ level: "info", text: `${unused.length} imported file(s) not used in this comp` });
  for (const l of comp.layers) {
    if (l.inPoint >= comp.duration) out.push({ level: "warn", text: `“${l.name}” starts after the comp ends` });
    if (l.outPoint <= 0) out.push({ level: "warn", text: `“${l.name}” ends before 0:00` });
    const p = valueAt(l.transform.position, 0);
    if (l.kind !== "audio" && l.kind !== "null" && (p[0] < -comp.width || p[0] > comp.width * 2 || p[1] < -comp.height || p[1] > comp.height * 2)) out.push({ level: "warn", text: `“${l.name}” is far outside the frame` });
    if (l.kind === "video" || l.kind === "image") {
      const m = project.media.find((x) => x.id === l.sourceId);
      if (m && m.height > 0 && m.height < comp.height * 0.6) out.push({ level: "warn", text: `“${l.name}” is low resolution (${m.width}×${m.height}) for this comp — may look soft` });
    }
  }
  const gaps = findGaps(comp);
  if (gaps.length) out.push({ level: "warn", text: `Empty frames (nothing visible) at ${gaps.map((g) => `${g[0].toFixed(1)}–${g[1].toFixed(1)}s`).join(", ")}` });
  if (!comp.layers.some((l) => l.kind === "audio" || (l.kind === "video" && project.media.find((m) => m.id === l.sourceId)?.hasAudio))) out.push({ level: "info", text: "No audio in this comp" });
  if (out.filter((o) => o.level === "warn").length === 0) out.push({ level: "ok", text: "No problems found in footage, layers and timing" });
  return out;
}

function findGaps(comp: Composition): [number, number][] {
  const visual = comp.layers.filter((l) => l.visible && l.kind !== "audio" && l.kind !== "null");
  if (!visual.length) return [];
  const gaps: [number, number][] = [];
  const step = 0.25;
  let start: number | null = null;
  for (let t = 0; t < comp.duration; t += step) {
    const covered = visual.some((l) => t >= l.inPoint && t < l.outPoint);
    if (!covered && start === null) start = t;
    if (covered && start !== null) {
      gaps.push([start, t]);
      start = null;
    }
  }
  if (start !== null) gaps.push([start, comp.duration]);
  return gaps.filter((g) => g[1] - g[0] >= 0.5).slice(0, 4);
}

export function plan(prompt: string): Plan {
  const s = useProject.getState();
  const comp = activeComp(s.project);
  const low = prompt.toLowerCase();
  const has = (...w: string[]): boolean => w.some((x) => low.includes(x));
  const steps: PlanStep[] = [];
  const notes: string[] = [];
  const add = (label: string, run: () => void): void => {
    steps.push({ label, run });
  };
  const t = parseTime(low);

  // composition-level
  const size = low.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (has("new comp", "composition", "comp ") && (size || has("tiktok", "youtube", "square", "reels"))) {
    const [w, h] = size ? [Number(size[1]), Number(size[2])] : has("tiktok", "reels") ? [1080, 1920] : has("square") ? [1080, 1080] : [1920, 1080];
    const fps = Number(low.match(/(\d{2})\s*fps/)?.[1] ?? 30);
    const dur = t ?? 10;
    add(`new_composition(${w}×${h}, ${fps} fps, ${dur}s)`, () => cmd.newComposition({ name: `Comp ${w}x${h}`, width: w, height: h, fps, duration: dur }));
  }
  if (has("workspace")) {
    const ws = has("animation") ? "Animation" : has("effect") ? "Effects" : has("minimal") ? "Minimal" : "Default";
    add(`workspace(${ws})`, () => buildLayout(ws));
  }

  if (!comp) return { steps, audit: audit(s.project, comp), notes, understood: steps.length > 0 };
  const { layer: target, named } = findLayer(comp, low, s.selectedLayerIds);
  const need = (what: string): Layer | null => {
    if (!target) {
      notes.push(`${what}: there are no layers yet`);
      return null;
    }
    if (!named) notes.push(`${what}: no layer named in the prompt → using “${target.name}”`);
    return target;
  };

  // creation
  const quoted = prompt.match(/["“]([^"”]+)["”]/)?.[1];
  if (has("add text", "title", "អត្ថបទ", "ចំណងជើង") && !has("subtitle")) {
    const text = quoted ?? "Title";
    add(`add_text("${text}")`, () => {
      const id = cmd.addLayer("text", { text });
      if (id && has("fade", "animate")) applyPreset("fadeIn", [id]);
    });
  }
  if (has("solid", "background")) {
    const color = low.match(/#[0-9a-f]{6}/)?.[0] ?? (has("black") ? "#000000" : has("white") ? "#ffffff" : has("red") ? "#d03b3b" : "#3d8bfd");
    add(`add_solid(${color})`, () => cmd.addLayer("solid", { color }));
  }
  if (has("rectangle", "ellipse", "circle", "polygon", "star")) {
    const kind = has("ellipse", "circle") ? "ellipse" : has("polygon", "star") ? "polygon" : "rect";
    add(`add_shape(${kind})`, () => cmd.addLayer("shape", { shapeKind: kind }));
  }

  // edit / time
  if (has("delete", "remove layer", "លុប")) {
    const l = need("delete");
    if (l) add(`delete_layer("${l.name}")`, () => cmd.deleteLayers([l.id]));
  }
  if (has("duplicate", "copy layer", "ចម្លង")) {
    const l = need("duplicate");
    if (l) add(`duplicate("${l.name}")`, () => cmd.duplicateLayers([l.id]));
  }
  if (has("split", "cut at", "កាត់")) {
    const l = need("split");
    const at = t ?? s.currentTime;
    if (t === null) notes.push(`split: no time given → current time ${at.toFixed(2)}s`);
    if (l) add(`split("${l.name}", ${at.toFixed(2)}s)`, () => cmd.splitLayers([l.id], at));
  }
  if (has("move", "start at", "ផ្លាស់") && t !== null) {
    const l = need("move");
    if (l) add(`move("${l.name}", start=${t}s)`, () => cmd.shiftLayers([l.id], t - l.inPoint));
  }
  if (has("trim", "length", "duration") && t !== null && !has("new comp")) {
    const l = need("trim");
    if (l) add(`trim("${l.name}", ${t}s)`, () => cmd.trimLayer(l.id, "out", l.inPoint + t));
  }

  // transform values
  const num = (re: RegExp): number | null => {
    const m = low.match(re);
    return m ? Number(m[1]) : null;
  };
  const op = num(/opacity\s*(?:to\s*)?(\d+)/);
  const sc = num(/scale\s*(?:to\s*)?(\d+)/);
  const rot = num(/rotat\w*\s*(?:to\s*|by\s*)?(-?\d+)/);
  if (op !== null) {
    const l = need("opacity");
    if (l) add(`opacity("${l.name}", ${op}%)`, () => cmd.setPropValue(l.id, "transform.opacity", op, "AI Opacity"));
  }
  if (sc !== null) {
    const l = need("scale");
    if (l) add(`scale("${l.name}", ${sc}%)`, () => cmd.setPropValue(l.id, "transform.scale", [sc, sc] as Vec2, "AI Scale"));
  }
  if (rot !== null && !has("spin")) {
    const l = need("rotation");
    if (l) add(`rotation("${l.name}", ${rot}°)`, () => cmd.setPropValue(l.id, "transform.rotation", rot, "AI Rotation"));
  }
  if (has("center")) {
    const l = need("center");
    if (l) add(`center("${l.name}")`, () => cmd.setPropValue(l.id, "transform.position", [comp.width / 2, comp.height / 2] as Vec2, "AI Center"));
  }

  // animation presets
  const presetWords: [string[], string][] = [
    [["fade in", "ចូលស្រាលៗ"], "fadeIn"],
    [["fade out"], "fadeOut"],
    [["pop"], "popIn"],
    [["slide"], "slideLeft"],
    [["rise", "rise up"], "riseUp"],
    [["spin", "បង្វិល"], "spin"],
    [["ken burns", "zoom in", "slow zoom"], "kenBurns"],
    [["wiggle", "shake"], "wiggle"],
  ];
  for (const [words, id] of presetWords) {
    if (!has(...words)) continue;
    const l = need("animate");
    const name = PRESETS.find((p) => p.id === id)?.name ?? id;
    if (l) add(`animate("${l.name}", ${name})`, () => applyPreset(id, [l.id]));
  }
  if (has("easy ease", "smooth")) add("easy_ease(selected keyframes)", () => cmd.easyEaseSelected("both"));

  // effects by name or keyword
  const fxWords: Record<string, string[]> = {
    gaussianBlur: ["blur"],
    glow: ["glow"],
    dropShadow: ["shadow"],
    brightnessContrast: ["brightness", "contrast", "brighter", "darker"],
    hueSaturation: ["saturation", "hue", "vivid"],
    curves: ["curves", "gamma"],
    tint: ["tint", "sepia"],
    fill: ["fill color"],
    displacement: ["distort", "displace", "turbulent"],
    gradientRamp: ["gradient"],
    invert: ["invert"],
  };
  if (!has("reset")) {
    for (const e of EFFECTS) {
      const words = [e.name.toLowerCase(), ...(fxWords[e.type] ?? [])];
      if (!words.some((w) => low.includes(w))) continue;
      const l = need("effect");
      if (l) add(`apply_effect("${l.name}", ${e.name})`, () => cmd.addEffect([l.id], e.type));
    }
  }
  if (has("reset")) {
    const l = need("reset");
    if (l && has("effect", "fx")) add(`reset_effects("${l.name}")`, () => l.effects.forEach((fx) => cmd.resetEffect(l.id, fx.id)));
    if (l && has("keyframe", "animation")) add(`clear_keyframes("${l.name}")`, () => ["transform.position", "transform.scale", "transform.rotation", "transform.opacity", "transform.anchor"].forEach((p) => { const prop = l.transform[p.slice(10) as keyof Layer["transform"]]; if (prop.keyframes.length) cmd.toggleStopwatch(l.id, p); }));
  }

  if (has("undo")) add("undo()", () => useProject.getState().undo());
  if (has("redo")) add("redo()", () => useProject.getState().redo());
  if (has("export", "render")) add("render_queue(add active comp, start)", () => {
    queueActiveComp();
    void runQueue();
  });

  return { steps, audit: audit(s.project, comp), notes, understood: steps.length > 0 };
}

export function runPlan(p: Plan): void {
  for (const step of p.steps) step.run();
}
