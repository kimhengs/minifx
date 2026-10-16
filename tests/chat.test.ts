import { describe, expect, it } from "vitest";
import { translateKhmer } from "../src/ai/chatStore";

describe("translateKhmer", () => {
  it("maps Khmer editing words and keeps quoted titles untouched", () => {
    const t = translateKhmer('ដាក់អក្សរ "សួស្តី Siem Reap" លេចឡើង');
    expect(t).toContain("add text");
    expect(t).toContain('"សួស្តី Siem Reap"');
    expect(t).toContain("fade in");
  });
  it("maps glow / split / seconds", () => {
    expect(translateKhmer("ពន្លឺលើអក្សរ")).toContain("glow");
    expect(translateKhmer("កាត់នៅ 5 វិនាទី")).toMatch(/split.*5s/);
  });
});
