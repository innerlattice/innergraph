import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { applyHighlight, applySelection, onKeyDown, onKeyUp, pointerOnHover, remember, render, selectedIds, wheelToViewport } from "../lib/canvasController";
import { GRAPH_STYLE } from "../lib/elements";
import { type Positions, loadPositions } from "../lib/layoutCache";
import { MiniMap } from "./MiniMap";

export interface GraphCanvasProps {
  elements: ElementDefinition[];
  selection: string[];
  highlight?: string[];
  onSelectionChange: (ids: string[]) => void;
}

/** Keyboard: Space pans while held, Escape clears the selection. */
function useKeys(cy: Core | undefined): void {
  useEffect(() => {
    if (!cy) return;
    const down = (e: KeyboardEvent) => onKeyDown(cy, e);
    const up = (e: KeyboardEvent) => onKeyUp(cy, e);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [cy]);
}

/**
 * Owns one Cytoscape instance. Click selects; Shift/Cmd/Ctrl-click adds; dragging on the
 * background draws a selection box. Node positions stay put across changes and time travel.
 */
export function GraphCanvas({ elements, selection, highlight = [], onSelectionChange }: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const [cy, setCy] = useState<Core>();
  const report = useRef(onSelectionChange);
  const positions = useRef<Positions>(loadPositions());
  const shown = useRef<Set<string>>(undefined);
  const redrawing = useRef(false);
  const current = useRef(selection);
  report.current = onSelectionChange;
  current.current = selection;

  useEffect(() => {
    const el = container.current as HTMLDivElement;
    const instance = cytoscape({ container: el, style: GRAPH_STYLE, boxSelectionEnabled: true, userPanningEnabled: false, userZoomingEnabled: false });
    let pending = 0;
    instance.on("select unselect", () => {
      if (redrawing.current) return;
      clearTimeout(pending);
      pending = window.setTimeout(() => report.current(selectedIds(instance)), 0);
    });
    instance.on("dragfree", "node", () => remember(instance, positions.current));
    pointerOnHover(instance, el);
    const wheel = (e: WheelEvent) => (e.preventDefault(), wheelToViewport(instance, e));
    el.addEventListener("wheel", wheel, { passive: false });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => instance.resize());
    resize?.observe(el);
    setCy(instance);
    return () => {
      resize?.disconnect();
      el.removeEventListener("wheel", wheel);
      instance.destroy();
    };
  }, []);

  useKeys(cy);

  useEffect(() => {
    if (!cy) return;
    // Redraws must not look like the user changing the selection.
    redrawing.current = true;
    shown.current = render(cy, elements, positions.current, shown.current);
    applySelection(cy, current.current);
    redrawing.current = false;
  }, [cy, elements]);

  useEffect(() => applySelection(cy, selection), [cy, selection, elements]);
  useEffect(() => applyHighlight(cy, highlight), [cy, highlight, elements]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={container} className="h-full w-full" data-testid="graph-canvas" />
      {cy ? <MiniMap cy={cy} /> : null}
    </div>
  );
}
