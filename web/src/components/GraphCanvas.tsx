import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import { applyHighlight, applySelection, remember, render } from "../lib/canvasController";
import { GRAPH_STYLE } from "../lib/elements";
import { type Positions, loadPositions } from "../lib/layoutCache";

export interface GraphCanvasProps {
  elements: ElementDefinition[];
  selected?: string;
  highlight?: string[];
  onSelect: (id: string | undefined) => void;
}

/** Owns one Cytoscape instance. Node positions stay put across changes and time travel. */
export function GraphCanvas({ elements, selected, highlight = [], onSelect }: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core>(undefined);
  const select = useRef(onSelect);
  const positions = useRef<Positions>(loadPositions());
  const shown = useRef<Set<string>>(undefined);
  select.current = onSelect;

  useEffect(() => {
    const instance = cytoscape({ container: container.current, style: GRAPH_STYLE, wheelSensitivity: 0.3 });
    instance.on("tap", (event) => select.current(event.target === instance ? undefined : event.target.id()));
    instance.on("dragfree", "node", () => remember(instance, positions.current));
    cy.current = instance;
    return () => instance.destroy();
  }, []);

  useEffect(() => {
    if (cy.current) shown.current = render(cy.current, elements, positions.current, shown.current);
  }, [elements]);

  useEffect(() => applySelection(cy.current, selected), [selected]);
  useEffect(() => applyHighlight(cy.current, highlight), [highlight, elements]);

  return <div ref={container} className="h-full w-full" data-testid="graph-canvas" />;
}
