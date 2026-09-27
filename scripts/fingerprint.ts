// Behaviour fingerprint: a hash of the server and web app as they would run, bundled, minified
// and tree-shaken. Renames of local names, dropped `export`s, type-only edits and deleting code
// nothing reaches all leave the hash unchanged, so a refactor that should be behaviour-neutral
// can prove it:
//
//   npm run fingerprint            # print the hashes
//   npm run fingerprint -- --save  # remember them in .fingerprint
//   npm run fingerprint -- --check # fail if they differ from .fingerprint
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");
const SAVED = resolve(ROOT, ".fingerprint");

const TARGETS = {
  server: { entryPoints: ["src/bin.ts"], platform: "node" as const, packages: "external" as const },
  web: { entryPoints: ["web/src/main.tsx"], platform: "browser" as const, jsx: "automatic" as const, loader: { ".css": "empty" as const }, external: ["*.css"] },
};

async function fingerprint(target: keyof typeof TARGETS): Promise<string> {
  const result = await build({ ...TARGETS[target], absWorkingDir: ROOT, bundle: true, minify: true, format: "esm", write: false, logLevel: "error", legalComments: "none", define: { "import.meta.env.DEV": "false" } });
  const hash = createHash("sha256");
  for (const file of result.outputFiles) hash.update(file.contents);
  return hash.digest("hex").slice(0, 16);
}

export async function fingerprints(): Promise<Record<string, string>> {
  return { server: await fingerprint("server"), web: await fingerprint("web") };
}

async function main() {
  const current = await fingerprints();
  const mode = process.argv[2];
  if (mode === "--save") writeFileSync(SAVED, `${JSON.stringify(current, null, 2)}\n`);
  if (mode === "--check") {
    const saved = existsSync(SAVED) ? JSON.parse(readFileSync(SAVED, "utf8")) : {};
    const changed = Object.keys(current).filter((k) => saved[k] !== current[k]);
    for (const k of Object.keys(current)) console.log(`${k.padEnd(7)} ${saved[k] ?? "(none)"} → ${current[k]}${changed.includes(k) ? "  CHANGED" : ""}`);
    if (changed.length > 0) process.exit(1);
    return;
  }
  for (const [k, v] of Object.entries(current)) console.log(`${k.padEnd(7)} ${v}`);
}

main();
