// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import cytoscape from "cytoscape";
import { afterEach, expect, it } from "vitest";
import { MiniMap, snapshot } from "./MiniMap";

afterEach(cleanup);

function graph() {
  const cy = cytoscape({
    headless: true,
    elements: [
      { data: { id: "a", color: "#123" }, position: { x: 0, y: 0 } },
      { data: { id: "b" }, position: { x: 100, y: 50 } },
      { data: { id: "ab", source: "a", target: "b" } },
    ],
  });
  cy.getElementById("b").position({ x: 100, y: 50 });
  return cy;
}

it("snapshots nodes, edges and the viewport", () => {
  const cy = graph();
  cy.getElementById("a").select();
  const snap = snapshot(cy);
  expect(snap.nodes.map((n) => [n.id, n.color, n.selected])).toEqual([["a", "#123", true], ["b", "#a8a29e", false]]);
  expect(snap.edges[0]).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 50 });
  expect(snapshot(cytoscape({ headless: true })).nodes).toEqual([]);
});

it("renders an overview and pans the graph on click and drag", () => {
  const cy = graph();
  render(<MiniMap cy={cy} />);
  const map = screen.getByRole("img", { name: /Minimap/ });
  expect(map.querySelectorAll("circle")).toHaveLength(2);
  const before = { ...cy.pan() };
  fireEvent.pointerDown(map, { clientX: 150, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(map, { clientX: 20, clientY: 20, buttons: 1 });
  fireEvent.pointerMove(map, { clientX: 90, clientY: 90, buttons: 0 });
  expect(cy.pan()).not.toEqual(before);
  cy.emit("render");
});
