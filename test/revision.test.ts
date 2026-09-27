import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRevisionPrompt, parseRevision } from "../src/engines/interpretationEngine.js";
import { type TestVault, makeVault } from "./helpers.js";

const OLD = "In the standup I froze in the meetng again. Later the shame made me want to hide.";
const NEW = "In the standup I froze in the meeting again. Later the shame made me want to hide. Resting helped.";

let t: TestVault;
let entry: string;
let ids: { freeze: string; shame: string };

beforeEach(() => {
  t = makeVault();
  entry = t.vault.ingest.addEntry({ content: OLD }, { interpret: false }).entry;
  t.vault.ingest.propose("agent:test", entry, {
    nodes: [
      { ref: "f", type: "process_node", label: "Freezing in the meetng", confidence: 0.8, quotes: ["I froze in the meetng"] },
      { ref: "s", type: "process_node", label: "Shame", confidence: 0.8, quotes: ["the shame made me want to hide"] },
    ],
    edges: [],
  });
  const nodes = Object.values(t.vault.explore.graph().nodes);
  ids = { freeze: nodes.find((n) => n.label.startsWith("Freezing"))?.id as string, shame: nodes.find((n) => n.label === "Shame")?.id as string };
});
afterEach(() => t.cleanup());

describe("revising an entry", () => {
  it("stores a revision, moves evidence that still matches and hides the old version", () => {
    const result = t.vault.ingest.reviseEntry(entry, NEW, { interpret: false });
    expect(result.previous).toBe(entry);
    expect(result.remapped).toBe(2);
    expect(result.cited.map((c) => [c.label, c.moved])).toEqual([
      ["Freezing in the meetng", true],
      ["Shame", true],
    ]);
    expect(t.vault.explore.entries().map((e) => e.id)).toEqual([result.entry]);
    const shame = t.vault.explore.node(ids.shame);
    expect(shame.evidence[0]).toMatchObject({ entry: result.entry, text: "the shame made me want to hide" });
    expect(t.vault.explore.node(ids.freeze).evidence[0]).toMatchObject({ entry: result.entry, text: "I froze in the meeting" });
  });

  it("lets the model fix a typo in a label, retract and add items", async () => {
    t.gateway.generateJson = async () => ({
      updates: [
        { id: ids.freeze, label: "Freezing in the meeting" },
        { id: ids.shame, label: "Shame" },
        { id: "unknown", label: "x" },
      ],
      retract: [{ id: "unknown" }],
      nodes: [{ ref: "r", type: "process_node", label: "Rest", confidence: 0.6, quotes: ["Resting helped"] }],
      edges: [],
    });
    const result = t.vault.ingest.reviseEntry(entry, NEW);
    await t.vault.queue.idle();
    expect(t.vault.ingest.job(result.session)?.state).toBe("done");
    const labels = Object.values(t.vault.explore.graph().nodes)
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(["Freezing in the meeting", "Rest", "Shame"]);
  });

  it("refuses unchanged text and edits of old versions", () => {
    expect(() => t.vault.ingest.reviseEntry(entry, OLD, { interpret: false })).toThrow("unchanged");
    t.vault.ingest.reviseEntry(entry, NEW, { interpret: false });
    expect(() => t.vault.ingest.reviseEntry(entry, "Other", { interpret: false })).toThrow("latest version");
  });
});

describe("amend", () => {
  it("applies agent corrections at once and ignores unknown ids", () => {
    const result = t.vault.ingest.amend("agent:claude", [{ id: ids.freeze, label: "Freezing in the meeting", attributes: {} }, { id: "nope" }]);
    expect(result.changed).toEqual([ids.freeze]);
    expect(result.dropped).toEqual(["nope: not found"]);
    expect(t.vault.explore.node(ids.freeze).node.label).toBe("Freezing in the meeting");
    const direct = t.vault.ingest.amend("user", [{ id: ids.shame, label: "Shame spiral" }]);
    expect(direct.changed).toEqual([ids.shame]);
    expect(t.vault.explore.node(ids.shame).node.label).toBe("Shame spiral");
  });
});

describe("revision prompt and parsing", () => {
  const input = () => ({
    entry: { id: "new", text: NEW, title: "t" },
    oldText: OLD,
    schema: t.vault.explore.schema() as never,
    context: [],
    cited: [
      { id: "a", kind: "node" as const, type: "process_node", label: "A", attributes: {}, quotes: ["x"], moved: false },
      { id: "b", kind: "edge" as const, type: "reinforces", label: "B", attributes: {}, quotes: [], moved: true },
    ],
  });

  it("shows old and new text and flags items whose passage changed", () => {
    const prompt = buildRevisionPrompt(input());
    expect(prompt.user).toContain("OLD version");
    expect(prompt.user).toContain('label="A"');
    expect(prompt.user).toContain("(its passage changed)");
    expect(buildRevisionPrompt({ ...input(), cited: [] }).user).toContain("(none)");
  });

  it("keeps only real changes to cited items", () => {
    const base = input();
    base.cited[0].type = "interoceptive";
    base.cited[0].attributes = { quality: "tight" };
    const updates = [
      { id: "a", label: " A " },
      { id: "b", label: "edges have no label", attributes: { x: 1 } },
      { id: "a", attributes: { bogus: 1, quality: "tight" } },
      { id: "a", label: "A2", attributes: { quality: "loose", location: "chest" } },
    ];
    const revision = parseRevision({ updates, retract: [{ id: "b" }] }, base);
    expect(revision.updates).toEqual([{ id: "a", label: "A2", attributes: { quality: "loose", location: "chest" } }]);
    expect(revision.retract).toEqual(["b"]);
    expect(parseRevision("garbage", input())).toMatchObject({ updates: [], retract: [] });
  });
});

describe("mapping spans through edits", async () => {
  const { boundaryMap, mapSpan } = await import("../src/managers/revision.js");
  const move = (oldText: string, newText: string, from: string) => {
    const start = Buffer.byteLength(oldText.slice(0, oldText.indexOf(from)));
    const span = mapSpan(boundaryMap(oldText, newText), oldText, newText, { start, end: start + Buffer.byteLength(from) });
    return span ? Buffer.from(newText).subarray(span.start, span.end).toString() : null;
  };

  it("follows insertions, typo fixes and replacements, even with several edits", () => {
    expect(move("abc XYZ def", "abc XYZW def", "XYZ")).toBe("XYZW");
    expect(move("abc XYZ def", "abc XYZ and more def", "XYZ")).toBe("XYZ");
    expect(move("so happy today", "so unhappy today", "happy")).toBe("unhappy");
    expect(move("Shame.", "Shame and more.", "Shame")).toBe("Shame");
    expect(move("I froze in the meetng. Shame.", "Today I froze in the meeting. Shame and more.", "froze in the meetng")).toBe("froze in the meeting");
    expect(move("the cat sat", "the dog sat", "cat")).toBe("dog");
    expect(move("héllo wörld", "héllo big wörld", "wörld")).toBe("wörld");
  });

  it("drops passages that were deleted", () => {
    expect(move("keep this. drop that.", "keep this.", "drop that")).toBeNull();
  });
});
