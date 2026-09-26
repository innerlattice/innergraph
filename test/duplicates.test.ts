import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnyDraft } from "../src/core/types.js";
import { join } from "node:path";
import { openDatabase } from "../src/access/database.js";
import { VaultAccess } from "../src/access/vaultAccess.js";
import { KEY, type TestVault, makeVault } from "./helpers.js";

let t: TestVault;
let entry: string;

/** Writes duplicates directly (as a pre-resolution Vault would contain), bypassing resolution. */
function legacyDuplicates() {
  const ev = (start: number, end: number) => [{ entry, start, end }];
  const node = (id: string, label: string, e: ReturnType<typeof ev>) => ({ id, type: "event", label, attributes: {}, confidence: 1, evidence: e });
  const edge = (id: string, from: string, to: string) => ({ id, type: "reinforces", from, to, sign: 1 as const, attributes: {}, confidence: 1, evidence: ev(0, 3) });
  const drafts: AnyDraft[] = [
    { actor: "user", session: "s", type: "NodeAsserted", body: node("v1", "Making video", ev(0, 10)) },
    { actor: "user", session: "s", type: "NodeAsserted", body: node("v2", "Video on energy", ev(2, 10)) },
    { actor: "user", session: "s", type: "NodeAsserted", body: node("other", "Walk", ev(20, 25)) },
    { actor: "user", session: "s", type: "EdgeAsserted", body: edge("e1", "v1", "other") },
    { actor: "user", session: "s", type: "EdgeAsserted", body: { ...edge("e2", "v1", "other"), evidence: [{ entry, start: 4, end: 8 }] } },
  ];
  // A second handle on the same file, like another process; the Vault picks the Events up.
  const raw = new VaultAccess(openDatabase(join(t.dir, "vault.db"), KEY));
  raw.append(drafts);
}

beforeEach(() => {
  t = makeVault();
  entry = t.vault.ingest.addEntry({ content: "Making video, then a walk." }, { interpret: false }).entry;
  legacyDuplicates();
});
afterEach(() => t.cleanup());

describe("duplicates", () => {
  it("finds duplicate nodes by shared passage and duplicate edges by key", () => {
    expect(t.vault.map.duplicates()).toEqual([
      { kind: "node", ids: ["v1", "v2"], reason: "duplicates of “Making video”" },
      { kind: "edge", ids: ["e1", "e2"], reason: "same endpoints and type" },
    ]);
  });

  it("merges them, keeping the oldest edge with all the evidence", () => {
    t.vault.map.mergeDuplicates();
    const graph = t.vault.explore.graph();
    expect(Object.values(graph.nodes).map((n) => n.label).sort()).toEqual(["Making video", "Walk"]);
    const edges = Object.values(graph.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0].evidence).toHaveLength(2);
    expect(t.vault.map.duplicates()).toEqual([]);
  });

  it("an agent's cleanup lands at once", () => {
    t.vault.map.mergeDuplicates("agent:claude");
    expect(t.vault.map.duplicates()).toEqual([]);
  });
});
