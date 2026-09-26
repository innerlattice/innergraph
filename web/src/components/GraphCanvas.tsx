import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import { GRAPH_STYLE } from "../lib/elements";

export interface GraphCanvasProps {
  elements: ElementDefinition[];
  selected?: string;
  highlight?: string[];
  onSelect: (id: string | undefined) => void;
}

function layout(cy: Core): void {
  cy.layout({ name: "cose", animate: false, padding: 40, nodeRepulsion: () => 9000, idealEdgeLength: () => 90 }).run();
}

/** Thin wrapper: owns one Cytoscape instance and re-lays out when elements change. */
export function GraphCanvas({ elements, selected, highlight = [], onSelect }: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core>(undefined);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const instance = cytoscape({ container: container.current, style: GRAPH_STYLE, wheelSensitivity: 0.3 });
    instance.on("tap", (event) => select.current(event.target === instance ? undefined : event.target.id()));
    cy.current = instance;
    return () => instance.destroy();
  }, []);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.elements().remove();
    instance.add(elements);
    layout(instance);
  }, [elements]);

  useEffect(() => {
    cy.current?.elements().unselect();
    if (selected) cy.current?.getElementById(selected).select();
  }, [selected]);

  useEffect(() => {
    const instance = cy.current;
    instance?.elements().removeClass("highlight");
    for (const id of highlight) instance?.getElementById(id).addClass("highlight");
    const ids = new Set(highlight);
    instance?.edges().filter((e) => ids.has(e.source().id()) && ids.has(e.target().id())).addClass("highlight");
  }, [highlight, elements]);

  return <div ref={container} className="h-full w-full" data-testid="graph-canvas" />;
}
