// Fetches the built-in embedding model into models/, checking every file against its pinned hash.
// The installers ship it, so the app itself never downloads anything. `npm run desktop` and
// `npm run dist` run this first; files already present and intact are left alone.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../src/paths.js";
import { BUILT_IN_MODEL } from "../src/utilities/localEmbedder.js";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fetchFile(path: string, expected: string): Promise<Uint8Array> {
  const url = `https://huggingface.co/${BUILT_IN_MODEL.repo}/resolve/${BUILT_IN_MODEL.revision}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`models: ${url} returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`models: ${path} doesn't match its pinned hash`);
  return bytes;
}

const dir = join(PATHS.models, BUILT_IN_MODEL.name);
mkdirSync(dir, { recursive: true });
for (const file of BUILT_IN_MODEL.files) {
  const target = join(dir, file.name);
  if (existsSync(target) && sha256(readFileSync(target)) === file.sha256) continue;
  console.log(`models: fetching ${BUILT_IN_MODEL.name}/${file.name}`);
  writeFileSync(target, await fetchFile(file.path, file.sha256));
}
console.log(`models: ${BUILT_IN_MODEL.name} is ready in ${dir}`);
