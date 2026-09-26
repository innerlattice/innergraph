import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedGateway } from "../src/utilities/modelGateway.js";
import { type Vault, initVault, openVault } from "../src/vault.js";

export const SCHEMA_FILE = join(import.meta.dirname, "..", "schema", "author.yaml");
export const ENTRY_1 = readFileSync(join(import.meta.dirname, "fixtures", "synthetic.md"), "utf8");
export const KEY = "a".repeat(64);

export interface TestVault {
  vault: Vault;
  gateway: ScriptedGateway;
  dir: string;
  reopen(): Vault;
  cleanup(): void;
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "inner-graph-"));
}

/** A clock that advances 1 second per call, starting 2026-01-01. */
export function steppingClock(start = Date.UTC(2026, 0, 1)): () => number {
  let t = start;
  return () => (t += 1000);
}

export function makeVault(responses: unknown[] = []): TestVault {
  const dir = tempDir();
  const gateway = new ScriptedGateway(responses);
  const vault = initVault({ dir, key: KEY, gateway, schemaFile: SCHEMA_FILE, now: steppingClock(), embedder: null, reranker: null });
  return {
    vault,
    gateway,
    dir,
    reopen: () => openVault({ dir, key: KEY, gateway, now: steppingClock(Date.UTC(2027, 0, 1)), embedder: null, reranker: null }),
    cleanup: () => {
      vault.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A model response for ENTRY_1 under the author Schema. */
export const INTERPRETATION_1 = {
  nodes: [
    { ref: "m1", type: "core_memory", label: "Father laughed when I cried", attributes: { age: "7" }, confidence: 0.8, quotes: ["my father laughed at me when I cried"] },
    { ref: "b1", type: "belief", label: "Needing things makes people turn away", attributes: { depth: "core" }, confidence: 0.7, quotes: ["needing things makes people turn away"] },
    { ref: "p1", type: "process_node", label: "Freezing", confidence: 0.8, quotes: ["I froze"] },
    { ref: "p2", type: "process_node", label: "Shame", confidence: 0.8, quotes: ["Freezing makes me ashamed"] },
    { ref: "p3", type: "process_node", label: "Rest", confidence: 0.6, quotes: ["When I rest properly"] },
    { ref: "bad", type: "not_a_type", label: "Invalid", confidence: 0.9, quotes: ["froze"] },
    { ref: "noquote", type: "belief", label: "Unsupported", confidence: 0.9, quotes: ["this sentence is not in the entry"] },
  ],
  edges: [
    { from: "m1", to: "b1", type: "abduces", confidence: 0.7, quotes: ["I learned that needing things makes people turn away"] },
    { from: "p1", to: "p2", type: "reinforces", sign: "+", confidence: 0.8, quotes: ["Freezing makes me ashamed"] },
    { from: "p2", to: "p1", type: "reinforces", sign: "+", confidence: 0.8, quotes: ["the shame makes me freeze even more"] },
    { from: "p3", to: "p2", type: "reinforces", sign: "-", confidence: 0.6, quotes: ["the shame gets quieter"] },
    { from: "p1", to: "m1", type: "abduces", confidence: 0.5, quotes: ["I froze"] },
  ],
};
