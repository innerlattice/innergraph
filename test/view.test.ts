import { describe, expect, it } from "vitest";
import { fold } from "../src/access/projection.js";
import { materialize, normaliseEvidence } from "../src/access/view.js";
import type { AnyEvent } from "../src/core/types.js";

let clock = 0;
const ev = (partial: Partial<AnyEvent> & Pick<AnyEvent, "type" | "body">): AnyEvent =>
  ({ id: `e${++clock}`, hlc: String(clock).padStart(4, "0"), device: "d", actor: "user", session: "s", parents: [], ...partial }) as AnyEvent;
const span = (start: number, end: number, entry = "h2") => ({ entry, start, end });
const node = (id: string, extra: object = {}) => ({
  type: "NodeAsserted" as const,
  body: { id, type: "t", label: id, attributes: {}, confidence: 1, evidence: [span(0, 10)], ...extra },
});
const edge = (id: string, from: string, to: string) => ({
  type: "EdgeAsserted" as const,
  body: { id, type: "r", from, to, attributes: {}, confidence: 1, evidence: [span(0, 3)] },
});

function scenario() {
  clock = 0;
  return fold([
    ev({ type: "EntryAdded", body: { entry: "h1", source: "t", title: "T", bytes: 10 } }),
    ev({ type: "EntryAdded", body: { entry: "h2", source: "t", title: "T", bytes: 10, revises: "h1", remap: [] } }),
    ev(node("approved")),
    ev({ ...node("proposed"), actor: "agent:a", session: "p1" }),
    ev(node("retired")),
    ev({ type: "Marked", body: { target: "retired", removed: true } }),
    ev(node("a")),
    ev(node("b")),
    ev({ type: "NodesMerged", body: { sources: ["a", "b"], into: { id: "ab", label: "AB", type: "t", attributes: {} } } }),
    ev(edge("x1", "approved", "proposed")),
    ev(edge("x2", "approved", "retired")),
  ]);
}

describe("materialized view", () => {
  it("says whether each item is removed and confirmed, and leaves refactored-away items out", () => {
    const view = materialize(scenario(), true);
    const state = Object.fromEntries(Object.values(view.nodes).map((n) => [n.id, [n.removed, n.confirmed]]));
    expect(state).toEqual({
      approved: [false, true],
      proposed: [false, false],
      retired: [true, true],
      ab: [false, true],
    });
    expect(view.replaced).toEqual({ a: ["ab"], b: ["ab"] });
    expect(view.removedCount).toBe(1);
  });

  it("materializes removed items only when asked, and edges only between materialized nodes", () => {
    const active = materialize(scenario());
    expect(Object.keys(active.nodes).sort()).toEqual(["ab", "approved", "proposed"]);
    expect(Object.keys(active.edges)).toEqual(["x1"]);
    expect(Object.keys(materialize(scenario(), true).edges).sort()).toEqual(["x1", "x2"]);
  });
});

describe("evidence normalisation", () => {
  it("hides passages in earlier Entry versions and merges overlapping quotes", () => {
    const state = scenario();
    const result = normaliseEvidence([span(0, 10, "h1"), span(353, 442), span(364, 442), span(500, 510)], state);
    expect(result).toEqual({ evidence: [span(353, 442), span(500, 510)], stale: 1 });
  });
});

describe("view through ExploreManager", async () => {
  const { ENTRY_1, INTERPRETATION_1, makeVault } = await import("./helpers.js");

  it("respects the removed filter for the map, a node's edges and single edges", async () => {
    const t = makeVault([INTERPRETATION_1]);
    t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
    await t.vault.queue.idle();
    const view = t.vault.explore.view();
    const rest = Object.values(view.nodes).find((n) => n.label === "Rest")?.id as string;
    const restEdge = Object.values(view.edges).find((e) => e.from === rest)?.id as string;
    t.vault.map.remove([restEdge], "agent:x");
    expect(t.vault.explore.node(rest).outgoing).toEqual([]);
    expect(t.vault.explore.node(rest, { removed: true }).outgoing[0]).toMatchObject({ id: restEdge, removed: true });
    expect(t.vault.explore.view({ removed: true }).edges[restEdge]?.removed).toBe(true);
    expect(t.vault.explore.edge(restEdge).edge?.removed).toBe(true);
    expect(t.vault.explore.view({ at: "2020-01-01" }).nodes).toEqual({});
    t.cleanup();
  });

  it("opens replaced nodes as history", async () => {
    const t = makeVault([INTERPRETATION_1]);
    t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
    await t.vault.queue.idle();
    const nodes = Object.values(t.vault.explore.view().nodes).filter((n) => n.label === "Rest" || n.label === "Freezing");
    t.vault.map.merge(
      nodes.map((n) => n.id),
      { label: "Merged" },
    );
    const old = t.vault.explore.node(nodes[0].id);
    expect(old.node?.removed).toBe(true);
    expect(old.derivedInto.map((n) => n.label)).toEqual(["Merged"]);
    expect(t.vault.explore.view().nodes[nodes[0].id]).toBeUndefined();
    t.cleanup();
  });
});
