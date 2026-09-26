// Imperative Cytoscape updates, kept out of React so they run headless in tests.
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { type Positions, appeared, partition, savePositions } from "./layoutCache";

cytoscape.use(fcose);

export function remember(cy: Core, positions: Positions): void {
  cy.nodes().forEach((n) => void positions.set(n.id(), { ...n.position() }));
  savePositions(positions);
}

/** Places remembered nodes, then lays out only the new ones around them (pinned). */
export function place(cy: Core, positions: Positions): void {
  const { known, unknown } = partition(cy.nodes().map((n) => n.id()), positions);
  for (const id of known) cy.getElementById(id).position(positions.get(id) as { x: number; y: number });
  if (unknown.length > 0) {
    const fixedNodeConstraint = known.map((nodeId) => ({ nodeId, position: positions.get(nodeId) }));
    const options = {
      name: "fcose",
      animate: false,
      fit: false,
      randomize: known.length === 0,
      fixedNodeConstraint,
      nodeSeparation: 90,
      idealEdgeLength: () => 110,
      nodeRepulsion: () => 12000,
    };
    cy.layout(options as cytoscape.LayoutOptions).run();
  }
  remember(cy, positions);
}

/** Replaces the elements, keeps positions stable and marks nodes that just appeared. Returns the shown ids. */
export function render(cy: Core, elements: ElementDefinition[], positions: Positions, previous?: Set<string>): Set<string> {
  cy.elements().remove();
  cy.add(elements);
  place(cy, positions);
  const ids = cy.nodes().map((n) => n.id());
  for (const id of appeared(previous, ids)) cy.getElementById(id).addClass("appeared");
  if (!previous || previous.size === 0) cy.fit(undefined, 48);
  return new Set(ids);
}

export function applySelection(cy: Core | undefined, selected?: string): void {
  cy?.elements().unselect();
  if (selected) cy?.getElementById(selected).select();
}

/** Highlights the given nodes and the edges between them. */
export function applyHighlight(cy: Core | undefined, highlight: string[]): void {
  if (!cy) return;
  cy.elements().removeClass("highlight");
  const ids = new Set(highlight);
  for (const id of highlight) cy.getElementById(id).addClass("highlight");
  cy.edges().filter((e) => ids.has(e.source().id()) && ids.has(e.target().id())).addClass("highlight");
}
