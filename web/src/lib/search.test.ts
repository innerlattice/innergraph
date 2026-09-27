import { describe, expect, it } from "vitest";
import type { ViewEdge, ViewNode } from "../api";
import { searchHits } from "./search";

const node = (id: string, label: string, type = "belief") => ({ id, label, type }) as ViewNode;
const edge = (id: string, from: string, to: string, type = "reinforces") => ({ id, from, to, type }) as ViewEdge;
const view = {
  nodes: { a: node("a", "Shame"), b: node("b", "Hidden shame"), c: node("c", "Keep scrolling", "policy") },
  edges: { ab: edge("ab", "a", "b"), bc: edge("bc", "b", "c"), ca: edge("ca", "c", "a", "felt_as") },
};

describe("search", () => {
  it("finds nothing to search for in an empty query", () => {
    expect(searchHits(view, "  ")).toBeNull();
  });

  it("finds nodes by title or kind, and links between found nodes or by their kind", () => {
    expect(searchHits(view, "SHAME")).toEqual(new Set(["a", "b", "ab"]));
    expect(searchHits(view, "policy")).toEqual(new Set(["c"]));
    expect(searchHits(view, "felt as")).toEqual(new Set(["ca"]));
  });
});
