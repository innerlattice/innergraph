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

/** Makes the canvas selection match `ids` without touching elements already in the right state. */
export function applySelection(cy: Core | undefined, ids: string[]): void {
  if (!cy) return;
  const wanted = new Set(ids);
  cy.elements(":selected").filter((el) => !wanted.has(el.id())).unselect();
  for (const id of ids) cy.getElementById(id).select();
}

export function selectedIds(cy: Core): string[] {
  return cy.elements(":selected").map((el) => el.id());
}

const ZOOM_SPEED = 0.01;

/** Trackpad-friendly wheel: two-finger scroll pans; pinch (ctrl+wheel) zooms at the pointer. */
export function wheelToViewport(cy: Core, e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; offsetX: number; offsetY: number }): void {
  if (e.ctrlKey || e.metaKey) {
    const level = cy.zoom() * Math.exp(-e.deltaY * ZOOM_SPEED);
    cy.zoom({ level, renderedPosition: { x: e.offsetX, y: e.offsetY } });
  } else {
    cy.panBy({ x: -e.deltaX, y: -e.deltaY });
  }
}

/** Space held: drag pans instead of drawing a selection box. */
export function setPanMode(cy: Core, panning: boolean): void {
  cy.userPanningEnabled(panning);
  cy.boxSelectionEnabled(!panning);
}

/** Highlights the given nodes and the edges between them. */
export function applyHighlight(cy: Core | undefined, highlight: string[]): void {
  if (!cy) return;
  cy.elements().removeClass("highlight");
  const ids = new Set(highlight);
  for (const id of highlight) cy.getElementById(id).addClass("highlight");
  cy.edges().filter((e) => ids.has(e.source().id()) && ids.has(e.target().id())).addClass("highlight");
}

type KeyLike = { code: string; key: string; target: EventTarget | null };

export function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return Boolean(el?.isContentEditable) || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName ?? "");
}

/** Space starts panning; Escape clears the selection. Ignored while typing in a field. */
export function onKeyDown(cy: Core, e: KeyLike): void {
  if (isTyping(e.target)) return;
  if (e.code === "Space") setPanMode(cy, true);
  if (e.key === "Escape") cy.elements().unselect();
}

export function onKeyUp(cy: Core, e: KeyLike): void {
  if (e.code === "Space") setPanMode(cy, false);
}
