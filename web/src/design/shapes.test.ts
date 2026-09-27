import { describe, expect, it } from "vitest";
import { type Point, cornersOf, inradius, inset } from "./shapes";

const SHAPES = ["rhomboid", "round-rectangle", "barrel", "round-diamond", "round-hexagon", "round-octagon", "round-triangle", "round-tag", "ellipse"];

/** Distance from p to the line through a and b. */
const toLine = (p: Point, a: Point, b: Point) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

describe("inset", () => {
  it.each(SHAPES)("brings every edge of a %s in by the same distance", (shape) => {
    const outer = cornersOf(shape, 120, 40);
    const inner = inset(outer, 4);
    outer.forEach((a, i) => {
      const b = outer[(i + 1) % outer.length];
      expect(toLine(inner[i], a, b)).toBeCloseTo(4);
      expect(toLine(inner[(i + 1) % inner.length], a, b)).toBeCloseTo(4);
    });
  });

  it("keeps half the depth as table when inset by half the inradius", () => {
    const outer = cornersOf("round-triangle", 30, 26);
    expect(inradius(inset(outer, inradius(outer) / 2))).toBeCloseTo(inradius(outer) / 2);
  });
});
