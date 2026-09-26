import { describe, expect, it } from "vitest";
import type { AnyEvent, Graph, Schema } from "../api";
import { ApiError, request } from "../api";
import { roleOf, toElements } from "./elements";
import { actorLabel, charIndex, colorFor, describeEvent, formatHlc, highlightSegments, labelsFrom, spanText } from "./format";

const schema = {
  name: "s",
  version: 1,
  nodeTypes: { a: { attributes: {} }, b: { attributes: {} } },
  edgeTypes: { d: { from: "*", to: "*", role: "derivational", attributes: {} }, c: { from: "*", to: "*", role: "causal", attributes: {} } },
} as Schema;

const base = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "user", assertedAt: "", updatedAt: "" };
const graph: Graph = {
  nodes: {
    n1: { ...base, id: "n1", type: "a", label: "One", status: "hypothesis", derivedFrom: [] },
    n2: { ...base, id: "n2", type: "b", label: "Two", status: "accepted", derivedFrom: [] },
  },
  edges: {
    e1: { ...base, id: "e1", type: "c", from: "n1", to: "n2", sign: -1, status: "accepted" },
    e2: { ...base, id: "e2", type: "d", from: "n2", to: "n1", sign: 1, status: "hypothesis" },
    e3: { ...base, id: "e3", type: "x", from: "n2", to: "n1", status: "hypothesis" },
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
    expect(labelsFrom(graph, [ev("NodeAsserted", { id: "n3", label: "Three" }), ev("SessionClosed", {})])).toEqual({ n1: "One", n2: "Two", n3: "Three" });
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

  it("formats actors and times", () => {
    expect(actorLabel("user")).toBe("you");
    expect(actorLabel("model:gemma")).toBe("gemma");
    expect(formatHlc("001700000000000.000000.d")).toMatch(/2023/);
  });
});

describe("graph elements", () => {
  it("classes nodes by status and edges by role and sign", () => {
    const elements = toElements(graph, schema);
    expect(elements.find((e) => e.data.id === "n1")?.classes).toBe("hypothesis");
    expect(elements.find((e) => e.data.id === "e1")?.classes).toBe("causal negative accepted");
    expect(elements.find((e) => e.data.id === "e2")?.classes).toBe("derivational positive hypothesis");
    expect(elements.find((e) => e.data.id === "e3")?.classes).toBe("plain  hypothesis");
    expect(roleOf(null, "c")).toBe("plain");
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
