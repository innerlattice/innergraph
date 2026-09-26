import { describe, expect, it } from "vitest";
import type { AnyEvent, MapGraphView, Schema } from "../api";
import { ApiError, request } from "../api";
import { boxSize, clip, edgeLabel, humanise, labelStyleOf, roleOf, toElements } from "./elements";
import { appeared, loadPositions, partition, savePositions } from "./layoutCache";
import { entryFocus, parseEntryFocus } from "./format";
import { actorLabel, charIndex, colorFor, describeEvent, formatHlc, highlightSegments, labelsFrom, spanText } from "./format";

const schema = {
  name: "s",
  version: 1,
  nodeTypes: { a: { attributes: {}, label: "statement", display: { shape: "round-rectangle", color: "#123456" } }, b: { attributes: {} } },
  edgeTypes: { d: { from: "*", to: "*", role: "derivational", attributes: {} }, c: { from: "*", to: "*", role: "causal", attributes: {} } },
} as Schema;

const base = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "user", assertedAt: "", updatedAt: "", held: false, staleEvidence: 0 };
const graph: Pick<MapGraphView, "nodes" | "edges"> = {
  nodes: {
    n1: { ...base, id: "n1", type: "a", label: "One", status: "proposed", held: true, derivedFrom: [] },
    n2: { ...base, id: "n2", type: "b", label: "Two", status: "approved", derivedFrom: [] },
  },
  edges: {
    e1: { ...base, id: "e1", type: "c", from: "n1", to: "n2", sign: -1, status: "approved" },
    e2: { ...base, id: "e2", type: "d", from: "n2", to: "n1", sign: 1, status: "proposed" },
    e3: { ...base, id: "e3", type: "x", from: "n2", to: "n1", status: "proposed" },
  },
};

const ev = (type: string, body: object): AnyEvent => ({ id: "e", hlc: "000001700000000.000000.d", device: "d", actor: "user", session: "s", parents: [], type, body }) as AnyEvent;

describe("format helpers", () => {
  it("colours types consistently and falls back for unknown ones", () => {
    expect(colorFor("a", schema)).not.toBe(colorFor("b", schema));
    expect(colorFor("unknown", null)).toMatch(/^#/);
  });

  it("slices by UTF-8 byte offsets", () => {
    expect(spanText("héllo world", 0, 6)).toBe("héllo");
    expect(charIndex("héllo", 3)).toBe(2);
  });

  it("splits text into cited and uncited segments", () => {
    const segments = highlightSegments("abcdef", [{ target: "x", start: 1, end: 3 }, { target: "y", start: 2, end: 4 }]);
    expect(segments).toEqual([
      { text: "a", cited: [] },
      { text: "b", cited: ["x"] },
      { text: "c", cited: ["x", "y"] },
      { text: "d", cited: ["y"] },
      { text: "ef", cited: [] },
    ]);
  });

  it("labels nodes from the graph and proposed events", () => {
    expect(labelsFrom(graph, [ev("NodeAsserted", { id: "n3", label: "Three" }), ev("SessionClosed", {})])).toEqual({
      n1: "One",
      n2: "Two",
      n3: "Three",
      e1: "One —c→ Two",
      e2: "Two —d→ One",
      e3: "Two —x→ One",
    });
  });

  it("describes every event type in plain words", () => {
    const labels = { n1: "One", n2: "Two" };
    const cases: [string, object, string][] = [
      ["NodeAsserted", { type: "a", label: "L", confidence: 0.8 }, "a: “L” · 80%"],
      ["EdgeAsserted", { type: "c", from: "n1", to: "n2", sign: -1, confidence: 0.5 }, "One —c (−)→ Two · 50%"],
      ["EdgeAsserted", { type: "c", from: "n1", to: "zzzzzzzz", sign: 1, confidence: 0.5 }, "One —c (+)→ zzzzzz · 50%"],
      ["EdgeAsserted", { type: "d", from: "n1", to: "n2", confidence: 1 }, "One —d→ Two · 100%"],
      ["StatusChanged", { target: "n1", status: "parked" }, "One → parked"],
      ["AttributesChanged", { target: "n2" }, "edit Two"],
      ["NodesSplit", { source: "n1", into: [{ label: "A" }, { label: "B" }] }, "split One into A, B"],
      ["NodesMerged", { sources: ["n1", "n2"], into: { label: "M" } }, "merge One + Two into “M”"],
      ["EntryAdded", { title: "T" }, "entry “T”"],
      ["SessionOpened", { purpose: "ingest" }, "session opened (ingest)"],
      ["ProposalReviewed", { accepted: [1], rejected: [] }, "reviewed: 1 merged, 0 declined"],
      ["SchemaChanged", { schema: { name: "s", version: 2 } }, "schema “s” v2"],
      ["SessionClosed", {}, "SessionClosed"],
    ];
    for (const [type, body, text] of cases) expect(describeEvent(ev(type, body), labels)).toBe(text);
  });

  it("encodes entry focus with an optional passage", () => {
    expect(parseEntryFocus(entryFocus("h", 3, 9))).toEqual({ entry: "h", span: { start: 3, end: 9 } });
    expect(parseEntryFocus("h")).toEqual({ entry: "h" });
    expect(parseEntryFocus(undefined)).toEqual({});
  });

  it("formats actors and times", () => {
    expect(actorLabel("user")).toBe("you");
    expect(actorLabel("model:gemma")).toBe("gemma");
    expect(formatHlc("001700000000000.000000.d")).toMatch(/2023/);
  });
});

describe("graph elements", () => {
  it("draws nodes from Schema display hints and label styles", () => {
    const elements = toElements(graph, schema);
    const n1 = elements.find((e) => e.data.id === "n1");
    expect(n1?.classes).toBe("proposed held style-statement");
    expect(n1?.data).toMatchObject({ shape: "round-rectangle", color: "#123456" });
    const n2 = elements.find((e) => e.data.id === "n2");
    expect(n2?.classes).toBe("approved style-name");
    expect(n2?.data.shape).toBe("ellipse");
    expect(labelStyleOf(null, "a")).toBe("name");
  });

  it("classes edges by role and sign, labelling causal edges by sign", () => {
    const elements = toElements(graph, schema);
    expect(elements.find((e) => e.data.id === "e1")).toMatchObject({ classes: "causal negative approved", data: { label: "−" } });
    expect(elements.find((e) => e.data.id === "e2")?.classes).toBe("derivational positive proposed");
    expect(elements.find((e) => e.data.id === "e3")?.classes).toBe("plain proposed");
    expect(edgeLabel({ ...graph.edges.e1, sign: 1 }, schema)).toBe("+");
    expect(edgeLabel(graph.edges.e3, schema)).toBe("x");
    expect(roleOf(null, "c")).toBe("plain");
  });

  it("clips long labels and sizes statement boxes to their text", () => {
    expect(clip("x".repeat(80))).toHaveLength(60);
    expect(clip("short")).toBe("short");
    expect(humanise("core_memory")).toBe("core memory");
    expect(boxSize("tiny")).toEqual({ w: 4 * 6.4 + 22, h: 33 });
    expect(boxSize("x".repeat(60)).h).toBe(3 * 15 + 18);
  });
});

describe("layout cache", () => {
  it("round-trips positions through storage and tolerates failures", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    savePositions(new Map([["a", { x: 1, y: 2 }]]), storage);
    expect(loadPositions(storage).get("a")).toEqual({ x: 1, y: 2 });
    expect(loadPositions({ getItem: () => "{bad" }).size).toBe(0);
    expect(() => savePositions(new Map(), { setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });

  it("separates known from new nodes and reports what appeared", () => {
    expect(partition(["a", "b"], new Map([["a", { x: 0, y: 0 }]]))).toEqual({ known: ["a"], unknown: ["b"] });
    expect(appeared(undefined, ["a"])).toEqual([]);
    expect(appeared(new Set(), ["a"])).toEqual([]);
    expect(appeared(new Set(["a"]), ["a", "b"])).toEqual(["b"]);
  });
});

describe("api.request", () => {
  it("posts JSON and raises API errors", async () => {
    const calls: RequestInit[] = [];
    const ok = (async (_url: string, init: RequestInit) => (calls.push(init), new Response('{"a":1}'))) as typeof fetch;
    expect(await request("/x", { b: 2 }, ok)).toEqual({ a: 1 });
    expect(calls[0].method).toBe("POST");
    const bad = (async () => new Response('{"error":"nope"}', { status: 404 })) as typeof fetch;
    await expect(request("/x", undefined, bad)).rejects.toThrow(ApiError);
    const blank = (async () => new Response("null", { status: 500 })) as typeof fetch;
    await expect(request("/x", undefined, blank)).rejects.toThrow("Request failed (500)");
  });
});
