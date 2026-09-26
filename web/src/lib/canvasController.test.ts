import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { applyHighlight, applySelection, render } from "./canvasController";
import type { Positions } from "./layoutCache";

const node = (id: string) => ({ data: { id } });
const edge = (id: string, source: string, target: string) => ({ data: { id, source, target } });

describe("canvas controller (headless)", () => {
  it("keeps known nodes where they were and marks new ones", () => {
    const cy = cytoscape({ headless: true });
    const positions: Positions = new Map();
    const first = render(cy, [node("a"), node("b"), edge("ab", "a", "b")], positions);
    expect(first).toEqual(new Set(["a", "b"]));
    const a = { ...cy.getElementById("a").position() };
    expect(cy.getElementById("a").hasClass("appeared")).toBe(false);

    render(cy, [node("a"), node("b"), node("c"), edge("ab", "a", "b"), edge("bc", "b", "c")], positions, first);
    expect(cy.getElementById("a").position()).toEqual(a);
    expect(cy.getElementById("c").hasClass("appeared")).toBe(true);
    expect(positions.has("c")).toBe(true);

    render(cy, [node("a")], positions, new Set(["a", "b", "c"]));
    expect(cy.getElementById("a").position()).toEqual(a);
  });

  it("applies selection and highlights, including edges between highlighted nodes", () => {
    const cy = cytoscape({ headless: true, elements: [node("a"), node("b"), node("c"), edge("ab", "a", "b"), edge("bc", "b", "c")] });
    applySelection(cy, "a");
    expect(cy.getElementById("a").selected()).toBe(true);
    applySelection(cy, undefined);
    expect(cy.getElementById("a").selected()).toBe(false);
    applyHighlight(cy, ["a", "b"]);
    expect(cy.getElementById("ab").hasClass("highlight")).toBe(true);
    expect(cy.getElementById("bc").hasClass("highlight")).toBe(false);
    applyHighlight(undefined, ["a"]);
    applySelection(undefined, "a");
  });
});
