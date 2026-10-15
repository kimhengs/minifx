import { beforeEach, describe, expect, it } from "vitest";
import * as cmd from "../src/commands";
import { applyPreset } from "../src/commands/presets";
import { createProject } from "../src/engine/factory";
import { renderOrder, resolveTransform, worldMatrix, apply } from "../src/engine/evaluate";
import { activeComp, HISTORY_LIMIT, useProject } from "../src/store/projectStore";
import type { Vec2 } from "../src/engine/types";

const comp = () => activeComp(useProject.getState().project)!;

beforeEach(() => {
  useProject.getState().load(createProject("Test", { width: 1920, height: 1080, fps: 30, duration: 10 }), null);
});

describe("commands + undo/redo", () => {
  it("adds a layer and undoes it", () => {
    const id = cmd.addLayer("solid");
    expect(comp().layers.map((l) => l.id)).toEqual([id]);
    useProject.getState().undo();
    expect(comp().layers).toHaveLength(0);
    useProject.getState().redo();
    expect(comp().layers).toHaveLength(1);
  });

  it("writes keyframes only when the stopwatch is on", () => {
    const id = cmd.addLayer("solid", { start: 0 })!;
    cmd.setPropValue(id, "transform.opacity", 50);
    expect(comp().layers[0].transform.opacity.value).toBe(50);
    cmd.toggleStopwatch(id, "transform.opacity");
    useProject.getState().setTime(2);
    cmd.setPropValue(id, "transform.opacity", 0);
    const keys = comp().layers[0].transform.opacity.keyframes;
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.time).sort()).toEqual([0, 2]);
  });

  it("merges a drag gesture into one undo step", () => {
    const id = cmd.addLayer("solid")!;
    const before = useProject.getState().past.length;
    useProject.getState().beginGesture("move");
    for (let i = 0; i < 20; i++) cmd.setPropValue(id, "transform.position", [i, i] as Vec2);
    useProject.getState().endGesture();
    expect(useProject.getState().past.length).toBe(before + 1);
    useProject.getState().undo();
    expect(comp().layers[0].transform.position.value).toEqual([960, 540]);
  });

  it("caps history at the limit", () => {
    const id = cmd.addLayer("solid")!;
    for (let i = 0; i < HISTORY_LIMIT + 30; i++) cmd.renameLayer(id, `n${i}`);
    expect(useProject.getState().past.length).toBe(HISTORY_LIMIT);
  });

  it("splits, trims and moves layers in time", () => {
    const id = cmd.addLayer("solid", { start: 0, duration: 10 })!;
    cmd.splitLayers([id], 4);
    expect(comp().layers).toHaveLength(2);
    expect(comp().layers.map((l) => [l.inPoint, l.outPoint]).sort()).toEqual([[0, 4], [4, 10]]);
    cmd.trimLayer(id, "in", 1);
    expect(comp().layers.find((l) => l.id === id)!.inPoint).toBe(1);
    cmd.shiftLayers([id], 2);
    const l = comp().layers.find((x) => x.id === id)!;
    expect([l.start, l.inPoint, l.outPoint]).toEqual([2, 3, 6]);
  });

  it("parents layers without cycles and composes transforms", () => {
    const a = cmd.addLayer("null")!;
    const b = cmd.addLayer("solid", { size: [100, 100] })!;
    expect(cmd.setParent(b, a)).toBe(true);
    expect(cmd.setParent(a, b)).toBe(false);
    cmd.setPropValue(a, "transform.position", [1060, 540] as Vec2);
    const lb = comp().layers.find((l) => l.id === b)!;
    const anchor = resolveTransform(lb, 0).anchor;
    const world = apply(worldMatrix(comp(), lb, 0), anchor);
    // parent moved +100px on x (its anchor is at 0,0, positioned at comp center initially)
    expect(world[0]).toBeCloseTo(960 + 960 + 100 - 960, 0);
  });

  it("applies effects, presets and copy/paste of keyframes", () => {
    const id = cmd.addLayer("text", { text: "Hi" })!;
    cmd.addEffect([id], "glow");
    expect(comp().layers[0].effects[0].type).toBe("glow");
    expect(applyPreset("fadeIn", [id])).toBe(1);
    const keys = comp().layers[0].transform.opacity.keyframes;
    expect(keys).toHaveLength(2);
    useProject.getState().selectKeys(keys.map((k) => ({ layerId: id, path: "transform.opacity", keyId: k.id })));
    expect(cmd.copySelectedKeys()).toBe(2);
    useProject.getState().setTime(5);
    cmd.pasteKeys(id);
    expect(comp().layers[0].transform.opacity.keyframes).toHaveLength(4);
  });

  it("honors solo and visibility in render order", () => {
    const a = cmd.addLayer("solid")!;
    const b = cmd.addLayer("solid")!;
    expect(renderOrder(comp(), 1).map((l) => l.id)).toEqual([a, b]);
    cmd.toggleLayerFlag(a, "solo");
    expect(renderOrder(comp(), 1).map((l) => l.id)).toEqual([a]);
  });
});
