import { describe, expect, it } from "vitest";
import { type Box, GAP, type Point, seed, separate } from "./placement";

const box = (id: string, x: number, y: number, w = 40, h = 40): Box => ({ id, x, y, w, h });
const clear = (p: Box, q: Box) => Math.abs(p.x - q.x) >= (p.w + q.w) / 2 + GAP - 0.01 || Math.abs(p.y - q.y) >= (p.h + q.h) / 2 + GAP - 0.01;

describe("seed", () => {
  const links: Record<string, string[]> = { n: ["a", "b"], m: ["n"], lone: [] };
  const neighbours = (id: string) => links[id] ?? [];
  const placed = new Map<string, Point>([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 200, y: 0 }],
  ]);

  it("starts a new node near what it links to, and one linked only to new nodes near them", () => {
    const starts = seed(["m", "n", "lone"], neighbours, placed);
    const n = starts.get("n") as Point;
    expect(Math.hypot(n.x - 100, n.y)).toBeCloseTo(90);
    const m = starts.get("m") as Point;
    expect(Math.hypot(m.x - n.x, m.y - n.y)).toBeCloseTo(90);
  });

  it("starts a node linked to nothing just outside the map", () => {
    const lone = seed(["lone"], neighbours, placed).get("lone") as Point;
    expect(Math.hypot(lone.x - 100, lone.y)).toBeCloseTo(190);
  });

  it("leaves a first layout to start from scratch", () => {
    expect(seed(["n"], neighbours, new Map()).size).toBe(0);
  });
});

describe("separate", () => {
  it("moves only the movable footprints until nothing overlaps", () => {
    const boxes = [box("a", 0, 0), box("b", 10, 5), box("c", 10, 5), box("d", 300, 300)];
    const moved = separate(boxes, new Set(["b", "c"]));
    expect([...moved.keys()]).toEqual(["b", "c"]);
    const after = boxes.map((b) => ({ ...b, ...moved.get(b.id) }));
    for (const p of after) for (const q of after) if (p !== q) expect(clear(p, q)).toBe(true);
  });

  it("leaves footprints that are already clear where they are", () => {
    expect(separate([box("a", 0, 0), box("b", 200, 0)], new Set(["b"]))).toEqual(new Map([["b", { x: 200, y: 0 }]]));
  });
});
