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

beforeEach(() => {
  t = makeVault([INTERPRETATION_1]);
});
afterEach(() => t.cleanup());

describe("1. Ingest", () => {
  it("interprets an Entry straight onto the map, unconfirmed, as one undoable Session", async () => {
    const result = await ingestFirst();
    expect(result.job?.state).toBe("done");

    const graph = t.vault.explore.graph();
    const labels = Object.values(graph.nodes)
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(["Father laughed when I cried", "Freezing", "Needing things makes people turn away", "Rest", "Shame"]);
    expect(Object.values(graph.nodes).every((n) => n.status === "hypothesis")).toBe(true);
    expect(Object.values(graph.nodes).every((n) => n.assertedBy === "model:scripted")).toBe(true);

    const [latest] = t.vault.explore.changes();
    expect(latest).toMatchObject({ session: result.session, purpose: "ingest", entry: result.entry });
    expect(latest.rows[0]).toMatchObject({ kind: "entry", label: "Tuesday evening", action: "added" });
    expect(latest.rows.filter((r) => r.kind === "node" && r.action === "added")).toHaveLength(5);
  });

  it("drops assertions without Evidence or outside the Schema", async () => {
    await ingestFirst();
    const labels = Object.values(t.vault.explore.graph().nodes).map((n) => n.label);
    expect(labels).not.toContain("Invalid");
    expect(labels).not.toContain("Unsupported");
  });

  it("undoes a whole ingest at once", async () => {
    const result = await ingestFirst();
    t.vault.map.undoSession(result.session);
    expect(t.vault.explore.graph().nodes).toEqual({});
    expect(t.vault.explore.view({ removed: true }).counts.removed).toBe(9);
    expect(() => t.vault.map.undoSession("nope")).toThrow("not found");
  });

  it("applies agents' amendments at once", async () => {
    await ingestFirst();
    const result = t.vault.ingest.amend("agent:test", [{ id: byLabel("Father laughed when I cried").id, label: "Dinner table memory" }, { id: "missing" }]);
    expect(result.changed).toHaveLength(1);
    expect(result.dropped).toEqual(["missing: not found"]);
    expect(byLabel("Dinner table memory").status).toBe("hypothesis");
  });

  it("records a failed interpretation and still closes the Session", async () => {
    t.vault.ingest.addEntry({ content: ENTRY_1 });
    const second = t.vault.ingest.addEntry({ content: "Another entry entirely." });
    await t.vault.queue.idle();
    expect(second.job?.state).toBe("failed");
    expect(t.vault.explore.timeline().some((e) => e.session === second.session && e.type === "SessionClosed")).toBe(true);
  });

  it("can store an Entry without interpretation", () => {
    const result = t.vault.ingest.addEntry({ content: "Just keep this." }, { interpret: false });
    expect(result.job).toBeUndefined();
    expect(t.vault.explore.entries()).toHaveLength(1);
  });
});

describe("2. Recall", () => {
  it("offers related Entries and Nodes on ingest", async () => {
    await ingestFirst();
    const result = t.vault.ingest.addEntry({ content: "In the meeting I froze again and felt the shame." }, { interpret: false });
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.related.map((r) => r.title)).toContain("Tuesday evening");
    expect(result.related.every((r) => r.snippet.length > 0)).toBe(true);
  });

  it("finds material related to a Node", async () => {
    await ingestFirst();
    const related = t.vault.explore.findRelated({ nodeId: byLabel("Freezing").id });
    expect(related.map((r) => [r.title, r.nodeType])).toContainEqual(["Shame", "process_node"]);
  });
});

describe("3. Trace roots", () => {
  it("ranks upstream roots along derivational Edges", async () => {
    await ingestFirst();
    const belief = byLabel("Needing things makes people turn away");
    const trace = t.vault.explore.traceRoots(belief.id);
    expect(trace.roots).toEqual([{ id: byLabel("Father laughed when I cried").id, support: 1, path: [byLabel("Father laughed when I cried").id, belief.id] }]);
  });
});

describe("4. Find loops", () => {
  it("returns reinforcing loops over causal Edges", async () => {
    await ingestFirst();
    const loops = t.vault.explore.findLoops();
    expect(loops).toHaveLength(1);
    expect(loops[0].polarity).toBe("reinforcing");
    expect(new Set(loops[0].nodes)).toEqual(new Set([byLabel("Freezing").id, byLabel("Shame").id]));
    const [detail] = t.vault.explore.loopDetails();
    expect(detail.inputs.map((s) => [s.fromLabel, s.sign])).toEqual([["Rest", -1]]);
    expect(detail.steps.every((s) => s.quotes.length > 0)).toBe(true);
  });
});

describe("5. Refactor", () => {
  it("splits a Node, reassigning Evidence and Edges with lineage", async () => {
    await ingestFirst();
    const shame = byLabel("Shame");
    const edges = Object.values(t.vault.explore.graph().edges).filter((e) => e.from === shame.id || e.to === shame.id);
    t.gateway.generateJson = async () => ({
      parts: [
        { evidence: [0], edges: [0, 1] },
        { evidence: [], edges: [2] },
      ],
    });
    const result = await t.vault.map.split(shame.id, [{ label: "Social shame" }, { label: "Body shame" }]);
    expect(result.session).toBeTruthy();
    expect(byLabel("Shame").status).toBe("superseded");
    const social = t.vault.explore.node(byLabel("Social shame").id);
    expect(social.derivedFrom.map((n) => n.id)).toEqual([shame.id]);
    expect(social.evidence).toHaveLength(1);
    expect(social.incoming.length + social.outgoing.length).toBe(2);
    expect(edges).toHaveLength(3);
    expect(t.vault.explore.node(shame.id).derivedInto).toHaveLength(2);
  });

  it("merges Nodes and keeps ids stable", async () => {
    await ingestFirst();
    const freezing = byLabel("Freezing");
    const rest = byLabel("Rest");
    t.vault.map.merge([freezing.id, rest.id], { label: "Arousal regulation" });
    const merged = byLabel("Arousal regulation");
    expect(merged.derivedFrom).toEqual([freezing.id, rest.id]);
    expect(merged.evidence).toHaveLength(2);
    expect(t.vault.explore.graph({ includeSuperseded: true }).nodes[freezing.id].status).toBe("superseded");
  });

  it("lands agents' refactors at once", async () => {
    await ingestFirst();
    const result = t.vault.map.merge([byLabel("Freezing").id, byLabel("Rest").id], { label: "X" }, "agent:test");
    expect(byLabel("X").assertedBy).toBe("agent:test");
    t.vault.map.undoSession(result.session);
    expect(byLabel("Freezing").status).toBe("hypothesis");
    expect(byLabel("X").status).toBe("superseded");
  });

  it("rejects malformed refactors", async () => {
    await ingestFirst();
    await expect(t.vault.map.split(byLabel("Rest").id, [{ label: "only one" }])).rejects.toThrow();
    expect(() => t.vault.map.merge([byLabel("Rest").id], { label: "x" })).toThrow();
  });
});

describe("6. Time travel", () => {
  it("renders the Graph at a past position and diffs two positions", async () => {
    const before = t.vault.map.positions().at(-1) as string;
    await ingestFirst();
    const after = t.vault.map.positions().at(-1) as string;
    expect(Object.keys(t.vault.map.graphAt(before).graph.nodes)).toHaveLength(0);
    expect(Object.keys(t.vault.map.graphAt(after).graph.nodes)).toHaveLength(5);
    const diff = t.vault.map.diff(before, after);
    expect(diff.nodes.added).toHaveLength(5);
    expect(diff.edges.added).toHaveLength(4);
    expect(t.vault.map.graphAt("2020-01-01").graph.nodes).toEqual({});
    expect(() => t.vault.map.graphAt("not a date")).toThrow();
  });
});

describe("7. Remove and confirm", () => {
  it("removes items from Recall, lets only the person confirm, and restores", async () => {
    await ingestFirst();
    const shame = byLabel("Shame");
    expect(t.vault.map.remove([shame.id, shame.id]).removed).toEqual([shame.id]);
    expect(t.vault.map.remove([shame.id]).removed).toEqual([]);
    expect(t.vault.explore.findRelated({ text: "shame" }).map((r) => r.id)).not.toContain(shame.id);
    t.vault.map.restore(shame.id);
    expect(() => t.vault.map.confirm([shame.id], "agent:any")).toThrow("Only the person");
    expect(t.vault.map.confirm([shame.id, shame.id]).confirmed).toHaveLength(1);
    expect(byLabel("Shame").status).toBe("accepted");
    expect(t.vault.explore.view().nodes[shame.id].confirmed).toBe(true);
  });
});

describe("8. Schema upgrades", () => {
  it("moves a Vault onto a newer version of its own Schema only", () => {
    const schema = t.vault.explore.schema();
    if (!schema) throw new Error("no schema");
    expect(t.vault.map.upgradeSchema(schema)).toBe(false);
    expect(t.vault.map.upgradeSchema({ ...schema, name: "other", version: schema.version + 1 })).toBe(false);
    expect(t.vault.map.upgradeSchema({ ...schema, version: schema.version + 1 })).toBe(true);
    expect(t.vault.explore.schema()?.version).toBe(schema.version + 1);
  });
});
