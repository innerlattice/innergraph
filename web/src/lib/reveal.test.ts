import cytoscape from "cytoscape";
import { expect, it, vi } from "vitest";
import { reveal, revealViewport } from "./reveal";

const clear = { x1: 32, y1: 32, x2: 468, y2: 568 };
const at = { zoom: 1, pan: { x: 0, y: 0 } };

it("leaves the map alone when what was picked is already in the clear", () => {
  expect(revealViewport({ x1: 100, y1: 100, x2: 140, y2: 130 }, at, clear, false)).toBeNull();
});

it("pans just far enough to bring it out from under the panel", () => {
  expect(revealViewport({ x1: 600, y1: 100, x2: 640, y2: 130 }, at, clear, false)).toEqual({ zoom: 1, pan: { x: -172, y: 0 } });
  expect(revealViewport({ x1: 100, y1: -50, x2: 140, y2: -20 }, at, clear, false)).toEqual({ zoom: 1, pan: { x: 0, y: 82 } });
});

it("zooms out only for several that don't fit, centring them; never zooms in", () => {
  const wide = { x1: 0, y1: 0, x2: 872, y2: 100 };
  expect(revealViewport(wide, at, clear, true)).toEqual({ zoom: 0.5, pan: { x: 32, y: 275 } });
  // One item too wide to fit is centred at the same zoom.
  expect(revealViewport(wide, at, clear, false)).toEqual({ zoom: 1, pan: { x: -186, y: 32 } });
  expect(revealViewport({ x1: 200, y1: 200, x2: 210, y2: 210 }, { zoom: 0.2, pan: { x: 0, y: 0 } }, clear, true)).toBeNull();
});

it("reports whether anything picked is on the map", () => {
  const cy = cytoscape({ headless: true, elements: [{ data: { id: "a" }, position: { x: 0, y: 0 } }] });
  expect(reveal(cy, ["gone"], 0)).toBe(false);
  expect(reveal(cy, ["a"], 400)).toBe(true);
});

it("lets a move under way finish when asked for the same place again", () => {
  const cy = cytoscape({ headless: true, layout: { name: "preset", fit: false }, elements: [{ data: { id: "a" }, position: { x: 5000, y: 5000 } }] });
  const animate = vi.spyOn(cy, "animate");
  reveal(cy, ["a"], 0);
  reveal(cy, ["a"], 0);
  expect(animate).toHaveBeenCalledOnce();
});
