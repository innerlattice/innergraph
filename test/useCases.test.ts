// Walks each core use case from SPEC.md through the Managers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphNode } from "../src/core/types.js";
import { ENTRY_1, INTERPRETATION_1, type TestVault, makeVault } from "./helpers.js";

let t: TestVault;

function byLabel(label: string): GraphNode {
  const node = Object.values(t.vault.explore.graph({ includeSuperseded: true }).nodes).find((n) => n.label === label);
  if (!node) throw new Error(`no node ${label}`);
  return node;
}

async function ingestFirst() {
  const result = t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
  await t.vault.queue.idle();
  return result;
}

async function ingestAndAcceptAll() {
  const result = await ingestFirst();
  const proposal = t.vault.ingest.proposal(result.session);
  t.vault.ingest.review(result.session, { accept: proposal.items.filter((i) => i.decision === "pending").map((i) => i.event.id) });
  return result;
}

beforeEach(() => {
  t = makeVault([INTERPRETATION_1]);
});
afterEach(() => t.cleanup());

describe("1. Ingest", () => {
  it("interprets an Entry into a Proposal and auto-accepts only low-impact Events", async () => {
    const result = await ingestFirst();
    expect(result.job?.state).toBe("done");
    const proposal = t.vault.ingest.proposal(result.session);
    expect(proposal.closed).toBe(true);
    expect(proposal.entryTitle).toBe("Tuesday evening");

    const graph = t.vault.explore.graph();
    const labels = Object.values(graph.nodes).map((n) => n.label).sort();
    expect(labels).toEqual(["Freezing", "Needing things makes people turn away", "Rest", "Shame"]);
    expect(Object.values(graph.nodes).every((n) => n.status === "hypothesis")).toBe(true);
    expect(Object.values(graph.nodes).every((n) => n.assertedBy === "model:scripted")).toBe(true);

    const held = proposal.items.filter((i) => i.decision === "pending");
    const reasons = held.flatMap((i) => i.reasons);
    expect(held).toHaveLength(4);
    expect(reasons).toContain("new root-level node");
    expect(reasons).toContain("closes a feedback loop");
    expect(reasons).toContain("depends on a node awaiting review");
    expect(t.vault.ingest.listProposals()).toHaveLength(1);
  });

  it("drops assertions without Evidence or outside the Schema", async () => {
    await ingestFirst();
    const labels = Object.values(t.vault.explore.graph().nodes).map((n) => n.label);
    expect(labels).not.toContain("Invalid");
    expect(labels).not.toContain("Unsupported");
  });

  it("merges surfaced Events on review and cascades rejections to dependent Edges", async () => {
    const result = await ingestFirst();
    const held = t.vault.ingest.proposal(result.session).items.filter((i) => i.decision === "pending");
    const memory = held.find((i) => i.event.type === "NodeAsserted") as (typeof held)[number];
    const view = t.vault.ingest.review(result.session, { reject: [memory.event.id] });
    expect(view.items.filter((i) => i.decision === "rejected")).toHaveLength(2);
    expect(view.pending).toBe(2);
    t.vault.ingest.review(result.session, { accept: view.items.filter((i) => i.decision === "pending").map((i) => i.event.id) });
    expect(t.vault.ingest.listProposals()).toHaveLength(0);
    expect(t.vault.ingest.listProposals("all")).toHaveLength(1);
  });

  it("applies amendments as user Events after accepting", async () => {
    const result = await ingestFirst();
    const memory = t.vault.ingest.proposal(result.session).items.find((i) => i.event.type === "NodeAsserted" && i.decision === "pending");
    t.vault.ingest.review(result.session, { amend: [{ eventId: memory?.event.id as string, label: "Dinner table memory", confidence: 0.9 }] });
    const node = byLabel("Dinner table memory");
    expect(node.confidence).toBe(0.9);
  });

  it("records a failed interpretation and still closes the Session", async () => {
    t.vault.ingest.addEntry({ content: ENTRY_1 });
    const second = t.vault.ingest.addEntry({ content: "Another entry entirely." });
    await t.vault.queue.idle();
    expect(second.job?.state).toBe("failed");
    expect(t.vault.ingest.proposal(second.session).closed).toBe(true);
  });

  it("can store an Entry without interpretation", () => {
    const result = t.vault.ingest.addEntry({ content: "Just keep this." }, { interpret: false });
    expect(result.job).toBeUndefined();
    expect(t.vault.explore.entries()).toHaveLength(1);
  });
});

describe("2. Recall", () => {
  it("offers related Entries and Nodes on ingest", async () => {
    await ingestAndAcceptAll();
    const result = t.vault.ingest.addEntry({ content: "In the meeting I froze again and felt the shame." }, { interpret: false });
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.related.map((r) => r.title)).toContain("Tuesday evening");
    expect(result.related.every((r) => r.snippet.length > 0)).toBe(true);
  });

  it("finds material related to a Node", async () => {
    await ingestAndAcceptAll();
    const related = t.vault.explore.findRelated({ nodeId: byLabel("Freezing").id });
    expect(related.map((r) => r.title)).toContain("Shame (process_node)");
  });
});

describe("3. Trace roots", () => {
  it("ranks upstream roots along derivational Edges", async () => {
    await ingestAndAcceptAll();
    const belief = byLabel("Needing things makes people turn away");
    const trace = t.vault.explore.traceRoots(belief.id);
    expect(trace.roots).toEqual([{ id: byLabel("Father laughed when I cried").id, support: 1, path: [byLabel("Father laughed when I cried").id, belief.id] }]);
  });
});

describe("4. Find loops", () => {
  it("returns reinforcing loops over causal Edges", async () => {
    await ingestAndAcceptAll();
    const loops = t.vault.explore.findLoops();
    expect(loops).toHaveLength(1);
    expect(loops[0].polarity).toBe("reinforcing");
    expect(new Set(loops[0].nodes)).toEqual(new Set([byLabel("Freezing").id, byLabel("Shame").id]));
  });
});

describe("5. Refactor", () => {
  it("splits a Node, reassigning Evidence and Edges with lineage", async () => {
    await ingestAndAcceptAll();
    const shame = byLabel("Shame");
    const edges = Object.values(t.vault.explore.graph().edges).filter((e) => e.from === shame.id || e.to === shame.id);
    t.gateway.generateJson = async () => ({ parts: [{ evidence: [0], edges: [0, 1] }, { evidence: [], edges: [2] }] });
    const result = await t.vault.map.split(shame.id, [{ label: "Social shame" }, { label: "Body shame" }]);
    expect(result.applied).toBe(true);
    expect(byLabel("Shame").status).toBe("superseded");
    const social = t.vault.explore.node(byLabel("Social shame").id);
    expect(social.derivedFrom.map((n) => n.id)).toEqual([shame.id]);
    expect(social.evidence).toHaveLength(1);
    expect(social.incoming.length + social.outgoing.length).toBe(2);
    expect(edges).toHaveLength(3);
    expect(t.vault.explore.node(shame.id).derivedInto).toHaveLength(2);
  });

  it("merges Nodes and keeps ids stable", async () => {
    await ingestAndAcceptAll();
    const freezing = byLabel("Freezing");
    const rest = byLabel("Rest");
    t.vault.map.merge([freezing.id, rest.id], { label: "Arousal regulation" });
    const merged = byLabel("Arousal regulation");
    expect(merged.derivedFrom).toEqual([freezing.id, rest.id]);
    expect(merged.evidence).toHaveLength(2);
    expect(t.vault.explore.graph({ includeSuperseded: true }).nodes[freezing.id].status).toBe("superseded");
  });

  it("holds agent refactors for review", async () => {
    await ingestAndAcceptAll();
    const result = t.vault.map.merge([byLabel("Freezing").id, byLabel("Rest").id], { label: "X" }, "agent:test");
    expect(result.applied).toBe(false);
    const proposal = t.vault.ingest.proposal(result.session);
    expect(proposal.items[0].reasons).toContain("refactor");
  });

  it("rejects malformed refactors", async () => {
    await ingestAndAcceptAll();
    await expect(t.vault.map.split(byLabel("Rest").id, [{ label: "only one" }])).rejects.toThrow();
    expect(() => t.vault.map.merge([byLabel("Rest").id], { label: "x" })).toThrow();
  });
});

describe("6. Time travel", () => {
  it("renders the Graph at a past position and diffs two positions", async () => {
    await ingestFirst();
    const before = t.vault.map.positions().at(-1) as string;
    const proposal = t.vault.ingest.listProposals()[0];
    t.vault.ingest.review(proposal.session, { accept: proposal.items.map((i) => i.event.id) });
    const after = t.vault.map.positions().at(-1) as string;
    expect(Object.keys(t.vault.map.graphAt(before).graph.nodes)).toHaveLength(4);
    expect(Object.keys(t.vault.map.graphAt(after).graph.nodes)).toHaveLength(5);
    const diff = t.vault.map.diff(before, after);
    expect(diff.nodes.added.map((n) => n.label)).toEqual(["Father laughed when I cried"]);
    expect(diff.edges.added).toHaveLength(3);
    expect(t.vault.map.graphAt("2020-01-01").graph.nodes).toEqual({});
    expect(() => t.vault.map.graphAt("not a date")).toThrow();
  });
});

describe("7. Park", () => {
  it("excludes parked Nodes from Recall and forbids agents from un-parking", async () => {
    await ingestAndAcceptAll();
    const shame = byLabel("Shame");
    t.vault.map.setStatus(shame.id, "parked");
    const related = t.vault.explore.findRelated({ text: "shame" });
    expect(related.map((r) => r.id)).not.toContain(shame.id);
    expect(() => t.vault.map.setStatus(shame.id, "accepted", "agent:any")).toThrow("No agent may un-park");
    t.vault.map.setStatus(shame.id, "hypothesis");
    expect(byLabel("Shame").status).toBe("hypothesis");
  });
});
