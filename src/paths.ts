// Where the app's own files are: the folder holding package.json, with schema/, plugin/ and the
// built web app beside it. Found by looking up from this module, so it holds whether the code
// runs from source or bundled into the desktop app.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRoot(start: string, exists: (file: string) => boolean = existsSync): string {
  let dir = start;
  while (!exists(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) return start;
    dir = up;
  }
  return dir;
}

export const ROOT = findRoot(import.meta.dirname);

export const PATHS = {
  schema: join(ROOT, "schema", "author.yaml"),
  plugin: join(ROOT, "plugin"),
  skill: join(ROOT, "plugin", "skills", "inner-graph", "SKILL.md"),
  web: join(ROOT, "web", "dist"),
};
