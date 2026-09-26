import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { applyHighlight, applySelection, isTyping, onKeyDown, onKeyUp, render, selectedIds, setPanMode, wheelToViewport } from "./canvasController";
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
    applySelection(cy, ["a", "ab"]);
    expect(selectedIds(cy).sort()).toEqual(["a", "ab"]);
    applySelection(cy, ["b"]);
    expect(selectedIds(cy)).toEqual(["b"]);
    applySelection(cy, []);
    expect(selectedIds(cy)).toEqual([]);
    applyHighlight(cy, ["a", "b"]);
    expect(cy.getElementById("ab").hasClass("highlight")).toBe(true);
    expect(cy.getElementById("bc").hasClass("highlight")).toBe(false);
    applyHighlight(undefined, ["a"]);
    applySelection(undefined, ["a"]);
  });
});

describe("viewport controls", () => {
  it("pans on scroll, zooms on pinch, and toggles pan mode", () => {
    const cy = cytoscape({ headless: true, elements: [node("a")] });
    const base = { deltaX: 10, deltaY: 20, ctrlKey: false, metaKey: false, offsetX: 0, offsetY: 0 };
    wheelToViewport(cy, base);
    expect(cy.pan()).toEqual({ x: -10, y: -20 });
    const zoom = cy.zoom();
    wheelToViewport(cy, { ...base, ctrlKey: true, deltaY: -50 });
    expect(cy.zoom()).toBeGreaterThan(zoom);
    setPanMode(cy, true);
    expect(cy.userPanningEnabled()).toBe(true);
    expect(cy.boxSelectionEnabled()).toBe(false);
    setPanMode(cy, false);
    expect(cy.boxSelectionEnabled()).toBe(true);
  });
});

describe("keyboard", () => {
  it("pans with Space, clears with Escape, and ignores typing", () => {
    const cy = cytoscape({ headless: true, elements: [node("a")] });
    cy.getElementById("a").select();
    onKeyDown(cy, { code: "Escape", key: "Escape", target: { tagName: "INPUT" } as never });
    expect(selectedIds(cy)).toEqual(["a"]);
    onKeyDown(cy, { code: "Escape", key: "Escape", target: null });
    expect(selectedIds(cy)).toEqual([]);
    onKeyDown(cy, { code: "Space", key: " ", target: null });
    expect(cy.userPanningEnabled()).toBe(true);
    onKeyUp(cy, { code: "KeyA", key: "a", target: null });
    expect(cy.userPanningEnabled()).toBe(true);
    onKeyUp(cy, { code: "Space", key: " ", target: null });
    expect(cy.userPanningEnabled()).toBe(false);
    expect(isTyping({ isContentEditable: true } as never)).toBe(true);
  });
});
