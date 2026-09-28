// Where the app's own files are: the folder holding package.json, with schema/, skill/ and the
// built web app beside it. Found by looking up from this module, so it holds whether the code
// runs from source or bundled into the desktop app.
import { existsSync, readFileSync } from "node:fs";
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
  skill: join(ROOT, "skill", "SKILL.md"),
  web: join(ROOT, "web", "dist"),
};

export const VERSION: string = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** How an agent works with the map: the in-app assistant's instructions, and what MCP sends every agent that connects. */
export function skillText(): string {
  return readFileSync(PATHS.skill, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
}
