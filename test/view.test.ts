import { describe, expect, it } from "vitest";
import { fold } from "../src/access/projection.js";
import { ACTIVE, VIEW_STATUSES, materialize, normaliseEvidence } from "../src/access/view.js";
import type { AnyEvent } from "../src/core/types.js";

let clock = 0;
const ev = (partial: Partial<AnyEvent> & Pick<AnyEvent, "type" | "body">): AnyEvent =>
  ({ id: `e${++clock}`, hlc: String(clock).padStart(4, "0"), device: "d", actor: "user", session: "s", parents: [], ...partial }) as AnyEvent;
const span = (start: number, end: number, entry = "h2") => ({ entry, start, end });
const node = (id: string, extra: object = {}) => ({ type: "NodeAsserted" as const, body: { id, type: "t", label: id, attributes: {}, confidence: 1, evidence: [span(0, 10)], ...extra } });
const edge = (id: string, from: string, to: string) => ({ type: "EdgeAsserted" as const, body: { id, type: "r", from, to, attributes: {}, confidence: 1, evidence: [span(0, 3)] } });

function scenario() {
  clock = 0;
  return fold([
    ev({ type: "EntryAdded", body: { entry: "h1", source: "t", title: "T", bytes: 10 } }),
    ev({ type: "EntryAdded", body: { entry: "h2", source: "t", title: "T", bytes: 10, revises: "h1", remap: [] } }),
    ev(node("approved")),
    ev({ ...node("proposed"), actor: "agent:a", session: "p1" }),
    ev({ type: "ProposalReviewed", body: { session: "p1", accepted: ["e4"], rejected: [] } }),
    ev({ ...node("held"), actor: "agent:a", session: "p2" }),
    ev({ ...node("rejected"), actor: "agent:a", session: "p2" }),
    ev({ type: "ProposalReviewed", body: { session: "p2", accepted: [], rejected: ["e7"] } }),
    ev(node("parked")),
    ev({ type: "StatusChanged", body: { target: "parked", status: "parked" } }),
    ev(node("retired")),
    ev({ type: "StatusChanged", body: { target: "retired", status: "superseded" } }),
    ev(node("a")),
    ev(node("b")),
    ev({ type: "NodesMerged", body: { sources: ["a", "b"], into: { id: "ab", label: "AB", type: "t", attributes: {} } } }),
    ev(edge("x1", "approved", "proposed")),
    ev(edge("x2", "approved", "retired")),
  ]);
}

describe("materialized view", () => {
  it("gives every item one status and leaves refactored-away items out", () => {
    const view = materialize(scenario(), VIEW_STATUSES);
    const status = Object.fromEntries(Object.values(view.nodes).map((n) => [n.id, [n.status, n.held]]));
    expect(status).toEqual({
      approved: ["approved", false],
      proposed: ["proposed", false],
      held: ["proposed", true],
      rejected: ["declined", false],
      parked: ["parked", false],
      retired: ["declined", false],
      ab: ["approved", false],
    });
    expect(view.counts).toEqual({ proposed: 2, approved: 2 + 2, parked: 1, declined: 2 });
  });

  it("materializes only the filtered statuses, and edges only between materialized nodes", () => {
    const active = materialize(scenario(), ACTIVE);
    expect(Object.keys(active.nodes).sort()).toEqual(["ab", "approved", "held", "parked", "proposed"]);
    expect(Object.keys(active.edges)).toEqual(["x1"]);
    expect(Object.keys(materialize(scenario(), VIEW_STATUSES).edges).sort()).toEqual(["x1", "x2"]);
    expect(materialize(scenario(), ["approved"]).nodes.held).toBeUndefined();
  });

  it("marks held items with the Event that proposed them", () => {
    expect(materialize(scenario()).nodes.held.proposedBy).toBe("e6");
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

  it("attaches review reasons, per-item changes and respects the declined filter", async () => {
    const t = makeVault([INTERPRETATION_1]);
    t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
    await t.vault.queue.idle();
    const view = t.vault.explore.view();
    const memory = Object.values(view.nodes).find((n) => n.label.startsWith("Father"));
    expect(memory).toMatchObject({ status: "proposed", held: true });
    expect(view.reasons[memory?.id as string]).toEqual(["new root-level node"]);

    const shame = Object.values(view.nodes).find((n) => n.label === "Shame")?.id as string;
    t.vault.map.setStatus(shame, "superseded", "agent:x");
    expect(t.vault.explore.view().changes[shame][0]).toMatchObject({ event: { type: "StatusChanged" }, reasons: ["status change proposed by an agent"] });

    const rest = Object.values(view.nodes).find((n) => n.label === "Rest")?.id as string;
    const restEdge = Object.values(view.edges).find((e) => e.from === rest)?.id as string;
    t.vault.ingest.decline([restEdge]);
    expect(t.vault.explore.node(rest).outgoing).toEqual([]);
    expect(t.vault.explore.node(rest, { declined: true }).outgoing[0]).toMatchObject({ id: restEdge, status: "declined" });
    expect(t.vault.explore.view({ declined: true }).edges[restEdge].status).toBe("declined");
    expect(t.vault.explore.edge(restEdge).edge.status).toBe("declined");

    const past = t.vault.explore.view({ at: "2020-01-01" });
    expect(past).toMatchObject({ nodes: {}, reasons: {}, changes: {} });
    t.cleanup();
  });

  it("opens replaced nodes as history", async () => {
    const t = makeVault([INTERPRETATION_1]);
    t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
    await t.vault.queue.idle();
    const nodes = Object.values(t.vault.explore.view().nodes).filter((n) => n.label === "Rest" || n.label === "Freezing");
    t.vault.map.merge(nodes.map((n) => n.id), { label: "Merged" });
    const old = t.vault.explore.node(nodes[0].id);
    expect(old.node.status).toBe("declined");
    expect(old.derivedInto.map((n) => n.label)).toEqual(["Merged"]);
    expect(t.vault.explore.view().nodes[nodes[0].id]).toBeUndefined();
    t.cleanup();
  });
});
