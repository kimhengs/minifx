import { describe, expect, it } from "vitest";
import { createProject, SCHEMA_VERSION } from "../src/engine/factory";
import { migrateProject, ProjectFormatError, serializeProject } from "../src/engine/migrations";

describe("project migrations", () => {
  it("upgrades a v1 project to the current schema", () => {
    const v1 = {
      schemaVersion: 1,
      id: "p",
      name: "Old",
      media: [],
      activeCompId: "c",
      compositions: [{ id: "c", name: "C", width: 100, height: 100, fps: 30, duration: 5, bg: "#000", layers: [{ id: "l", name: "L", kind: "solid", effects: [] }] }],
    };
    const p = migrateProject(v1);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.compositions[0].workArea).toEqual([0, 5]);
    expect(p.compositions[0].markers).toEqual([]);
    expect(p.compositions[0].layers[0].masks).toEqual([]);
    expect(p.compositions[0].layers[0].audioEnabled).toBe(true);
  });

  it("round-trips through serialize", () => {
    const p = createProject("Round trip");
    const again = migrateProject(JSON.parse(serializeProject(p)));
    expect(again.name).toBe("Round trip");
    expect(again.compositions[0].id).toBe(p.compositions[0].id);
  });

  it("rejects files from a newer version and garbage", () => {
    expect(() => migrateProject({ schemaVersion: 999, compositions: [], media: [] })).toThrow(ProjectFormatError);
    expect(() => migrateProject("nope")).toThrow(ProjectFormatError);
  });
});
