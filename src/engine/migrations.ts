import { SCHEMA_VERSION } from "./factory";
import type { Project } from "./types";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Each migration upgrades a raw project object by exactly one schema version.
 * v1 -> v2: compositions gained workArea + markers, layers gained masks/shy/audioEnabled.
 */
const MIGRATIONS: Record<number, (p: Json) => Json> = {
  1: (p) => {
    const comps = Array.isArray(p.compositions) ? p.compositions : [];
    for (const c of comps) {
      if (!isObj(c)) continue;
      const duration = typeof c.duration === "number" ? c.duration : 10;
      if (!Array.isArray(c.workArea)) c.workArea = [0, duration];
      if (!Array.isArray(c.markers)) c.markers = [];
      const layers = Array.isArray(c.layers) ? c.layers : [];
      for (const l of layers) {
        if (!isObj(l)) continue;
        if (!Array.isArray(l.masks)) l.masks = [];
        if (typeof l.shy !== "boolean") l.shy = false;
        if (typeof l.audioEnabled !== "boolean") l.audioEnabled = true;
        if (!Array.isArray(l.effects)) l.effects = [];
      }
    }
    p.schemaVersion = 2;
    return p;
  },
};

export class ProjectFormatError extends Error {}

export function migrateProject(raw: unknown): Project {
  if (!isObj(raw)) throw new ProjectFormatError("File is not a MiniFX project");
  let p: Json = structuredClone(raw);
  let v = typeof p.schemaVersion === "number" ? p.schemaVersion : 1;
  if (v > SCHEMA_VERSION) {
    throw new ProjectFormatError(`Project was saved by a newer version (schema ${v}). Please update MiniFX.`);
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new ProjectFormatError(`No migration from schema ${v}`);
    p = step(p);
    v = p.schemaVersion as number;
  }
  if (!Array.isArray(p.compositions) || !Array.isArray(p.media)) {
    throw new ProjectFormatError("Project is missing compositions or media");
  }
  return p as unknown as Project;
}

export function serializeProject(p: Project): string {
  return JSON.stringify({ ...p, schemaVersion: SCHEMA_VERSION, modifiedAt: new Date().toISOString() }, null, 1);
}
