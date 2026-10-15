import { describe, expect, it } from "vitest";
import { anim, cubicBezier, lerpValue, makeKey, speedAt, valueAt } from "../src/engine/interpolation";
import type { AnimProp, Vec2 } from "../src/engine/types";

describe("interpolation", () => {
  it("returns the static value when there are no keyframes", () => {
    expect(valueAt(anim(42), 3)).toBe(42);
  });

  it("interpolates linearly and clamps outside the keyed range", () => {
    const p: AnimProp<number> = { value: 0, keyframes: [makeKey(0, 0), makeKey(2, 100)] };
    expect(valueAt(p, -1)).toBe(0);
    expect(valueAt(p, 1)).toBeCloseTo(50);
    expect(valueAt(p, 5)).toBe(100);
  });

  it("interpolates Vec2 and colors", () => {
    const p: AnimProp<Vec2> = { value: [0, 0], keyframes: [makeKey(0, [0, 0] as Vec2), makeKey(1, [10, 20] as Vec2)] };
    expect(valueAt(p, 0.5)).toEqual([5, 10]);
    expect(lerpValue("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("holds the value until the next keyframe with hold interpolation", () => {
    const p: AnimProp<number> = { value: 0, keyframes: [makeKey(0, 0, "hold"), makeKey(1, 10)] };
    expect(valueAt(p, 0.99)).toBe(0);
    expect(valueAt(p, 1)).toBe(10);
  });

  it("easy ease starts and ends slower than linear", () => {
    const a = makeKey(0, 0, "bezier");
    const b = makeKey(1, 100, "bezier");
    a.easeOut = 0.333;
    b.easeIn = 0.333;
    const p: AnimProp<number> = { value: 0, keyframes: [a, b] };
    expect(valueAt(p, 0.1)).toBeLessThan(10);
    expect(valueAt(p, 0.5)).toBeCloseTo(50, 0);
    expect(valueAt(p, 0.9)).toBeGreaterThan(90);
    expect(speedAt(p, 0.5)).toBeGreaterThan(speedAt(p, 0.05));
  });

  it("orders keyframes by time regardless of array order", () => {
    const p: AnimProp<number> = { value: 0, keyframes: [makeKey(2, 20), makeKey(0, 0)] };
    expect(valueAt(p, 1)).toBeCloseTo(10);
  });

  it("solves cubic beziers monotonically", () => {
    const f = cubicBezier(0.42, 0, 0.58, 1);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
  });
});
