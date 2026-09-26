import { describe, expect, it } from "vitest";
import { fit, panToCentre, toMini, toModel, union } from "./minimap";

describe("minimap geometry", () => {
  it("fits bounds into the box and maps both ways", () => {
    const t = fit({ x1: 0, y1: 0, x2: 100, y2: 50 }, 112, 62);
    expect(t.scale).toBe(1);
    const p = toMini(t, { x: 50, y: 25 });
    expect(p).toEqual({ x: 56, y: 31 });
    expect(toModel(t, p)).toEqual({ x: 50, y: 25 });
  });

  it("handles degenerate bounds and unions boxes", () => {
    expect(fit({ x1: 5, y1: 5, x2: 5, y2: 5 }, 20, 20).scale).toBe(8);
    expect(union({ x1: 0, y1: 0, x2: 1, y2: 1 }, { x1: -1, y1: 2, x2: 3, y2: 4 })).toEqual({ x1: -1, y1: 0, x2: 3, y2: 4 });
  });

  it("computes the pan that centres a model point", () => {
    expect(panToCentre({ x: 10, y: 20 }, 2, { width: 100, height: 60 })).toEqual({ x: 30, y: -10 });
  });
});
