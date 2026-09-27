import { describe, expect, it } from "vitest";
import { currentIds, successorsOf } from "./successors";

const view = {
  nodes: { c: {}, d: {}, e: {} },
  edges: { x: {} },
  replaced: { a: ["c"], b: ["c"], s: ["d", "t"], t: ["e"], loop: ["loop"] },
} as never;

describe("successors", () => {
  it("follows merges and splits to what is on the map now", () => {
    expect(successorsOf(view, "a")).toEqual(["c"]);
    expect(successorsOf(view, "s")).toEqual(["d", "e"]);
    expect(successorsOf(view, "x")).toEqual(["x"]);
    expect(successorsOf(view, "gone")).toEqual([]);
    expect(successorsOf(view, "loop")).toEqual([]);
  });

  it("maps a selection onto current ids, once each", () => {
    expect(currentIds(view, ["a", "b", "x", "gone"])).toEqual(["c", "x", "gone"]);
    expect(currentIds(undefined, ["a"])).toEqual(["a"]);
  });
});
