import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bestMatch, labelSimilarity, resolve, spansOverlap } from "../src/engines/resolution.js";
import { type TestVault, makeVault } from "./helpers.js";

const ev = (start: number, end: number, entry = "h") => ({ entry, start, end });

describe("resolution rules", () => {
  it("scores label similarity on content words", () => {
    expect(labelSimilarity("The Hider", "the hider")).toBe(1);
    expect(labelSimilarity("Shame", "Feeling of shame")).toBeCloseTo(2 / 3);
    expect(labelSimilarity("Rest", "Control")).toBe(0);
    expect(labelSimilarity("I", "i")).toBe(1);
  });

  it("detects overlapping passages of the same entry", () => {
    expect(spansOverlap(ev(0, 10), ev(5, 12))).toBe(true);
    expect(spansOverlap(ev(0, 10), ev(9, 30))).toBe(false);
    expect(spansOverlap(ev(0, 10), ev(0, 10, "other"))).toBe(false);
  });

  it("prefers a shared passage over a different label", () => {
    const known = [
      { id: "a", type: "event", label: "Making video", evidence: [ev(10, 30)] },
      { id: "b", type: "event", label: "Video on energy management", evidence: [ev(90, 99)] },
    ];
    const match = bestMatch({ id: "n", type: "event", label: "Video on energy management", attributes: {}, confidence: 1, evidence: [ev(12, 30)] }, known);
    expect(match).toMatchObject({ node: { id: "a" }, reason: "cites the same passage" });
  });

  it("merges same things, flags similar ones, and dedupes edges by endpoints and type", () => {
    const known = {
      nodes: [
        { id: "hider", type: "part", label: "The Hider", evidence: [ev(0, 5)] },
        { id: "shame", type: "process_node", label: "Shame", evidence: [ev(50, 55)] },
      ],
      edges: [{ id: "e1", type: "reinforces", from: "hider", to: "shame" }],
    };
    const result = {
      dropped: [],
      nodes: [
        { id: "n1", type: "part", label: "the hider", attributes: { a: 1 }, confidence: 0.5, evidence: [ev(100, 110)] },
        { id: "n2", type: "process_node", label: "Feeling of shame", attributes: {}, confidence: 0.5, evidence: [ev(200, 210)] },
        { id: "n3", type: "part", label: "The Hider", attributes: { b: 2 }, confidence: 0.9, evidence: [ev(300, 310)] },
      ],
      edges: [
        { id: "x1", type: "reinforces", from: "n1", to: "shame", attributes: {}, confidence: 0.5, evidence: [ev(1, 2)] },
        { id: "x2", type: "reinforces", from: "hider", to: "shame", attributes: {}, confidence: 0.5, evidence: [ev(3, 4)] },
        { id: "x3", type: "reinforces", from: "n2", to: "hider", attributes: {}, confidence: 0.5, evidence: [] },
      ],
    };
    const { result: out, merged } = resolve(result, known);
    expect(merged.map((m) => [m.id, m.into])).toEqual([
      ["n1", "hider"],
      ["n3", "hider"],
    ]);
    expect(out.nodes.map((n) => [n.id, n.similarTo])).toEqual([
      ["hider", undefined],
      ["n2", ["shame"]],
    ]);
    expect(out.nodes[0]).toMatchObject({ label: "The Hider", attributes: { a: 1, b: 2 }, confidence: 0.9 });
    expect(out.nodes[0].evidence).toHaveLength(2);
    expect(out.edges.map((e) => [e.id, e.from, e.to, e.evidence.length])).toEqual([
      ["e1", "hider", "shame", 2],
      ["x3", "n2", "hider", 0],
    ]);
  });
});

describe("resolution on every write path", () => {
  const TEXT = "I saw this making video and the shame came back. Resting helped.";
  let t: TestVault;
  let entry: string;

  beforeEach(() => {
    t = makeVault();
    entry = t.vault.ingest.addEntry({ content: TEXT }, { interpret: false }).entry;
    t.vault.ingest.propose("agent:a", entry, {
      nodes: [
        { ref: "v", type: "event", label: "Making video", confidence: 0.9, quotes: ["I saw this making video"] },
        { ref: "s", type: "process_node", label: "Shame", confidence: 0.9, quotes: ["the shame came back"] },
      ],
      edges: [{ from: "v", to: "s", type: "reinforces", sign: "+", confidence: 0.5, quotes: ["the shame came back"] }],
    });
  });
  afterEach(() => t.cleanup());

  const counts = () => ({ nodes: Object.keys(t.vault.explore.graph().nodes).length, edges: Object.keys(t.vault.explore.graph().edges).length });

  it("agents re-proposing the same things re-assert instead of duplicating", () => {
    const result = t.vault.ingest.propose("agent:b", entry, {
      nodes: [
        { ref: "v2", type: "event", label: "Video on energy management", confidence: 0.9, quotes: ["making video"] },
        { ref: "s2", type: "process_node", label: "shame", confidence: 0.9, quotes: ["shame came back"] },
      ],
      edges: [{ from: "v2", to: "s2", type: "reinforces", sign: "+", confidence: 0.7, quotes: ["came back"] }],
    });
    expect(result.merged?.map((m) => m.reason)).toEqual(["cites the same passage"]);
    expect(counts()).toEqual({ nodes: 2, edges: 1 });
  });

  it("holds a merely similar node for review, naming what it may duplicate", () => {
    const result = t.vault.ingest.propose("agent:b", entry, { nodes: [{ ref: "x", type: "process_node", label: "Shame spiral", confidence: 0.9, quotes: ["Resting helped"] }], edges: [] });
    const reasons = t.vault.ingest.proposal(result.session).items.flatMap((i) => i.reasons);
    expect(reasons).toContain("may duplicate “Shame”");
    expect(t.vault.ingest.pendingChanges().assertions[0].item).not.toHaveProperty("similarTo", undefined);
  });

  it("a revision that re-asserts everything (renamed, retracted) creates no duplicates", async () => {
    const graph = t.vault.explore.graph();
    const video = Object.values(graph.nodes).find((n) => n.type === "event")?.id as string;
    const edge = Object.keys(graph.edges)[0];
    t.gateway.generateJson = async () => ({
      updates: [{ id: video, label: "Video on energy management" }],
      retract: [{ id: edge }],
      nodes: [
        { ref: "v", type: "event", label: "Video on energy management", confidence: 0.9, quotes: ["I saw this making video"] },
        { ref: "s", type: "process_node", label: "Shame", confidence: 0.9, quotes: ["the shame came back"] },
      ],
      edges: [{ from: "v", to: "s", type: "reinforces", sign: "+", confidence: 0.5, quotes: ["the shame came back"] }],
    });
    t.vault.ingest.reviseEntry(entry, `${TEXT} Tomorrow I rest again.`);
    await t.vault.queue.idle();
    expect(counts()).toEqual({ nodes: 2, edges: 1 });
    expect(t.vault.ingest.pendingChanges().other).toEqual([]);
    expect(t.vault.explore.graph().nodes[video].label).toBe("Video on energy management");
  });
});

describe("context retrieval for large graphs", async () => {
  const { contextFor, CONTEXT_LIMIT } = await import("../src/managers/resolve.js");
  const { openDatabase } = await import("../src/access/database.js");
  const { VaultAccess } = await import("../src/access/vaultAccess.js");
  const { KEY, tempDir } = await import("./helpers.js");

  it("shows everything for small graphs and only related or cited nodes for large ones", () => {
    const vault = new VaultAccess(openDatabase(`${tempDir()}/v.db`, KEY));
    const entry = vault.putBlob(new TextEncoder().encode("shame spiral"), "text/plain");
    const node = (id: string, label: string, evidence: { entry: string; start: number; end: number }[] = []) => ({
      actor: "user", session: "s", type: "NodeAsserted" as const,
      body: { id, type: "process_node", label, attributes: {}, confidence: 1, evidence },
    });
    vault.append([node("cited", "Cited elsewhere", [{ entry, start: 0, end: 5 }]), node("shame", "Shame spiral")]);
    expect(contextFor(vault, vault.state(), "anything")).toHaveLength(2);
    vault.append(Array.from({ length: CONTEXT_LIMIT }, (_, i) => node(`n${i}`, `Unrelated topic ${i}`)));
    const ids = contextFor(vault, vault.state(), "Tonight the shame spiral again.", entry).map((c) => c.id).sort();
    expect(ids).toEqual(["cited", "shame"]);
  });
});
