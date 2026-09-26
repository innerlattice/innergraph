import { describe, expect, it } from "vitest";
import { loadSchemaFile } from "../src/access/schemaAccess.js";
import type { AnyEvent, Graph, GraphEdge, GraphNode } from "../src/core/types.js";
import { AnalysisEngine, activeGraph } from "../src/engines/analysisEngine.js";
import { locate, quoteToEvidence } from "../src/engines/evidenceLocator.js";
import {
  InterpretationEngine,
  buildPrompt,
  describeSchema,
  normaliseAssignment,
  parseInterpretation,
  usableLabel,
} from "../src/engines/interpretationEngine.js";
import { RecallEngine, cosine, tokenize } from "../src/engines/recallEngine.js";
import { ReviewEngine } from "../src/engines/reviewEngine.js";
import { ScriptedGateway } from "../src/utilities/modelGateway.js";
import { INTERPRETATION_1, SCHEMA_FILE } from "./helpers.js";

const schema = loadSchemaFile(SCHEMA_FILE);
const roles = { d: "derivational", c: "causal", i: "identity" } as const;

function gNode(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, type: "t", label: id, attributes: {}, confidence: 0.5, status: "hypothesis", evidence: [], derivedFrom: [], assertedBy: "user", assertedAt: "", updatedAt: "", ...extra };
}

function gEdge(id: string, from: string, to: string, type: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { id, type, from, to, attributes: {}, confidence: 0.5, status: "hypothesis", evidence: [], assertedBy: "user", assertedAt: "", updatedAt: "", ...extra };
}

function graphOf(nodes: string[], edges: GraphEdge[]): Graph {
  return { nodes: Object.fromEntries(nodes.map((n) => [n, gNode(n)])), edges: Object.fromEntries(edges.map((e) => [e.id, e])) };
}

describe("evidence locator", () => {
  const text = "Héllo there.\nThe  shame   makes me freeze.";

  it("finds exact and whitespace/case-insensitive quotes as byte ranges", () => {
    expect(locate(text, "there")).toEqual({ index: 6, length: 5 });
    expect(locate(text, "the shame makes")).toEqual({ index: 13, length: 18 });
    expect(quoteToEvidence("h", text, "there")).toEqual({ entry: "h", start: 7, end: 12 });
    expect(quoteToEvidence("h", text, "missing")).toBeNull();
    expect(locate(text, "   ")).toBeNull();
  });
});

describe("InterpretationEngine", () => {
  const entry = { id: "h", title: "T", text: "I froze. Freezing makes me ashamed. my father laughed at me when I cried. I learned that needing things makes people turn away. When I rest properly the shame gets quieter. the shame makes me freeze even more" };
  const input = { entry, schema, context: [{ id: "old", type: "belief", label: "Old belief" }] };

  it("describes the Schema and builds a prompt with context", () => {
    expect(describeSchema(schema)).toContain("abduces (core_memory -> belief) [derivational]");
    expect(describeSchema(schema)).toContain("depth: core|derived|leaf");
    expect(describeSchema(schema)).toContain('Label: name, a short name for the part, e.g. "The Hider"');
    expect(describeSchema({ ...schema, nodeTypes: { x: { attributes: {} } } })).toContain("- x: ");
    const prompt = buildPrompt(input);
    expect(prompt.user).toContain("- id=old type=belief: Old belief");
    expect(buildPrompt({ ...input, context: [] }).user).toContain("(none)");
  });

  it("keeps valid assertions, drops the rest, and signs causal edges", () => {
    const result = parseInterpretation(INTERPRETATION_1, input);
    expect(result.nodes).toHaveLength(5);
    expect(result.edges).toHaveLength(4);
    expect(result.dropped).toHaveLength(3);
    expect(result.edges.map((e) => e.sign)).toEqual([undefined, 1, 1, -1]);
  });

  it("reuses existing Nodes and rejects type mismatches", () => {
    const raw = {
      nodes: [
        { ref: "x", existing_id: "old", type: "belief", label: "ignored", confidence: 2, quotes: ["I froze"], attributes: { depth: "leaf", bogus: 1 } },
        { ref: "y", existing_id: "old", type: "part", label: "wrong", confidence: 0.5, quotes: ["I froze"] },
      ],
      edges: [{ from: "old", to: "nowhere", type: "scaffolds", confidence: 0.5, quotes: ["I froze"] }, { from: "x", to: "old", type: "scaffolds", confidence: 0.5, quotes: ["absent"] }],
    };
    const result = parseInterpretation(raw, input);
    expect(result.nodes).toEqual([{ id: "old", type: "belief", label: "Old belief", attributes: { depth: "leaf" }, confidence: 1, evidence: [expect.any(Object)] }]);
    expect(result.dropped).toHaveLength(3);
  });

  it("falls back to the first quote when the label echoes the type", () => {
    expect(usableLabel({ label: "Belief", type: "belief", quotes: ["needing things makes people turn away"] })).toBe("needing things makes people turn away");
    expect(usableLabel({ label: " ", type: "belief", quotes: ["x".repeat(80)] })).toHaveLength(58);
    expect(usableLabel({ label: "", type: "belief", quotes: [] })).toBe("belief");
    expect(usableLabel({ label: "Real label", type: "belief", quotes: [] })).toBe("Real label");
  });

  it("treats an identical type and label as reuse of an existing Node", () => {
    const raw = { nodes: [{ ref: "x", type: "belief", label: "  old BELIEF ", confidence: 0.5, quotes: ["I froze"] }], edges: [] };
    expect(parseInterpretation(raw, input).nodes[0].id).toBe("old");
    const other = { nodes: [{ ref: "x", type: "part", label: "Old belief", confidence: 0.5, quotes: ["I froze"] }], edges: [] };
    expect(parseInterpretation(other, input).nodes[0].id).not.toBe("old");
  });

  it("reports malformed model output", () => {
    expect(parseInterpretation({ nodes: "nope" }, input).dropped[0]).toContain("expected shape");
  });

  it("interprets via the gateway and assigns split parts", async () => {
    const gateway = new ScriptedGateway([INTERPRETATION_1, { parts: [{ evidence: [1], edges: [] }, { evidence: [0, 5], edges: [0] }] }]);
    const engine = new InterpretationEngine(gateway);
    expect(engine.modelName).toBe("scripted");
    expect((await engine.interpret(input)).nodes).toHaveLength(5);
    expect(engine.check(INTERPRETATION_1, input).edges).toHaveLength(4);
    const parts = await engine.assignSplit({ label: "n", parts: ["a", "b"], evidence: ["e0", "e1"], edges: ["x"] });
    expect(parts).toEqual([{ evidence: [1], edges: [] }, { evidence: [0], edges: [0] }]);
    expect(await engine.assignSplit({ label: "n", parts: ["a", "b"], evidence: ["e0"], edges: [] })).toEqual([{ evidence: [0], edges: [] }, { evidence: [], edges: [] }]);
  });

  it("normalises split assignments so every index lands once", () => {
    expect(normaliseAssignment(2, null, { evidence: 2, edges: 1 })).toEqual([{ evidence: [0, 1], edges: [0] }, { evidence: [], edges: [] }]);
  });
});

describe("ReviewEngine", () => {
  const engine = new ReviewEngine();
  const ev = (id: string, type: string, body: object, actor = "model:x"): AnyEvent => ({ id, hlc: id, device: "d", actor, session: "s", parents: [], type, body }) as AnyEvent;
  const nodeBody = (id: string, type: string, confidence = 0.8) => ({ id, type, label: id, attributes: {}, confidence, evidence: [] });
  const edgeBody = (id: string, from: string, to: string, type: string) => ({ id, type, from, to, attributes: {}, confidence: 0.8, evidence: [] });

  it("surfaces new roots, loops, refactors and status changes", () => {
    const graph = graphOf(["p1", "p2"], [gEdge("c1", "p1", "p2", "reinforces")]);
    const events = [
      ev("1", "NodeAsserted", nodeBody("m", "core_memory")),
      ev("2", "NodeAsserted", nodeBody("b", "belief")),
      ev("3", "EdgeAsserted", edgeBody("a", "m", "b", "abduces")),
      ev("4", "EdgeAsserted", edgeBody("c2", "p2", "p1", "reinforces")),
      ev("5", "NodesMerged", { sources: [], into: {} }),
      ev("6", "StatusChanged", { target: "p1", status: "accepted" }),
      ev("7", "EdgeAsserted", edgeBody("self", "p1", "p1", "reinforces")),
      ev("8", "AttributesChanged", { target: "p1", patch: {} }),
    ];
    const triage = engine.triage(events, graph, schema);
    expect(triage.autoAccept).toEqual(["2", "8"]);
    expect(Object.fromEntries(triage.review.map((r) => [r.eventId, r.reasons[0]]))).toEqual({
      "1": "new root-level node",
      "3": "depends on a node awaiting review",
      "4": "closes a feedback loop",
      "5": "refactor",
      "6": "status change proposed by an agent",
      "7": "closes a feedback loop",
    });
  });

  it("honours a manual policy, a confidence floor and a missing Schema", () => {
    const events = [ev("1", "NodeAsserted", nodeBody("p", "process_node", 0.2)), ev("2", "EdgeAsserted", edgeBody("e", "x", "y", "reinforces"))];
    expect(engine.triage(events, graphOf([], []), schema, { autoAccept: false, minAutoConfidence: 0 }).autoAccept).toEqual([]);
    expect(engine.triage(events, graphOf([], []), schema, { autoAccept: true, minAutoConfidence: 0.5 }).review[0].reasons).toEqual(["confidence below auto-accept threshold"]);
    expect(engine.triage(events, graphOf([], []), null).autoAccept).toEqual(["1", "2"]);
  });

  it("cascades rejected new Nodes to their Edges", () => {
    const events = [ev("1", "NodeAsserted", nodeBody("n", "belief")), ev("2", "EdgeAsserted", edgeBody("e", "n", "x", "scaffolds")), ev("3", "NodeAsserted", nodeBody("x", "belief"))];
    expect(engine.cascadeRejections(events, ["1"], graphOf([], []))).toEqual(["1", "2"]);
    expect(engine.cascadeRejections(events, ["3"], graphOf(["x"], []))).toEqual(["3"]);
  });
});

describe("AnalysisEngine", () => {
  const engine = new AnalysisEngine();

  it("traces roots ranked by downstream support", () => {
    const graph = graphOf(["r1", "r2", "mid", "leaf", "other"], [
      gEdge("1", "r1", "mid", "d"),
      gEdge("2", "mid", "leaf", "d"),
      gEdge("3", "r2", "leaf", "d"),
      gEdge("4", "r1", "other", "d"),
      gEdge("5", "leaf", "r2", "c"),
    ]);
    const trace = engine.traceRoots(graph, roles, "leaf");
    expect(trace.upstream.sort()).toEqual(["mid", "r1", "r2"]);
    expect(trace.roots).toEqual([
      { id: "r1", support: 3, path: ["r1", "mid", "leaf"] },
      { id: "r2", support: 1, path: ["r2", "leaf"] },
    ]);
    expect(engine.traceRoots(graph, roles, "r1").roots).toEqual([]);
  });

  it("classifies loops by sign product and ignores superseded items", () => {
    const graph = graphOf(["a", "b", "c"], [gEdge("1", "a", "b", "c", { sign: -1 }), gEdge("2", "b", "a", "c", { sign: 1 }), gEdge("3", "b", "c", "c"), gEdge("4", "c", "b", "c")]);
    const loops = engine.findLoops(graph, roles);
    expect(loops.map((l) => l.polarity)).toEqual(["balancing", "reinforcing"]);
    graph.nodes.c.status = "superseded";
    expect(engine.findLoops(graph, roles)).toHaveLength(1);
    expect(Object.keys(activeGraph(graph).edges)).toEqual(["1", "2"]);
  });

  it("groups identity components and diffs graphs", () => {
    const before = graphOf(["a", "b", "gone"], [gEdge("1", "a", "b", "i")]);
    expect(engine.groups(before, roles)).toEqual([["a", "b"]]);
    const after = graphOf(["a", "b", "new"], [gEdge("1", "a", "b", "i")]);
    after.nodes.a.label = "renamed";
    after.nodes.b.updatedAt = "later";
    const diff = engine.diff(before, after);
    expect(diff.nodes.added.map((n) => n.id)).toEqual(["new"]);
    expect(diff.nodes.removed.map((n) => n.id)).toEqual(["gone"]);
    expect(diff.nodes.changed.map((c) => c.after.id)).toEqual(["a"]);
    expect(diff.edges.changed).toEqual([]);
  });
});

describe("RecallEngine", () => {
  const engine = new RecallEngine();
  const corpus = [
    { id: "e1", kind: "entry" as const, text: "I froze in the meeting and felt shame afterwards." },
    { id: "e2", kind: "entry" as const, text: "Gardening on sunday, tomatoes are growing." },
    { id: "n1", kind: "node" as const, text: "Shame spiral after freezing" },
  ];

  it("tokenizes without stopwords and short tokens", () => {
    expect(tokenize("I froze, and the SHAME's back!")).toEqual(["froze", "shame's", "back"]);
  });

  it("ranks similar documents and respects excludes, thresholds and limits", () => {
    const matches = engine.recall("shame after the meeting", corpus);
    expect(matches.map((m) => m.id)).toEqual(["e1", "n1"]);
    expect(matches[0].terms).toContain("meeting");
    expect(engine.recall("shame", corpus, { exclude: ["e1"] }).map((m) => m.id)).toEqual(["n1"]);
    expect(engine.recall("shame", corpus, { limit: 1 })).toHaveLength(1);
    expect(engine.recall("shame", corpus, { threshold: 0.99 })).toEqual([]);
    expect(engine.recall("", corpus)).toEqual([]);
  });

  it("computes cosine similarity of empty vectors as zero", () => {
    expect(cosine(new Map(), new Map()).score).toBe(0);
  });
});
