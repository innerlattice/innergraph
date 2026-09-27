import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { type RefObject, useEffect, useRef, useState } from "react";
import { applyHighlight, applySearch, applySelection, onKeyDown, onKeyUp, pointerOnHover, remember, render, selectedIds, tidy, wheelToViewport } from "../lib/canvasController";
import { GRAPH_STYLE } from "../design/graph";
import { type Positions, loadPositions } from "../lib/layoutCache";
import { reveal } from "../lib/reveal";
import { MiniMap } from "./MiniMap";

export interface GraphCanvasProps {
  elements: ElementDefinition[];
  selection: string[];
  highlight?: string[];
  /** What a search found, lit while everything else fades; null when not searching. */
  found?: Set<string> | null;
  onSelectionChange: (ids: string[]) => void;
  /** Counts requests to lay the whole map out afresh. */
  tidied?: number;
  /** Something floating over the map's right side; a new selection is brought into view clear of it. */
  cover?: RefObject<HTMLElement | null>;
}

/** How many pixels of the canvas's right side `cover` hides. */
function coveredWidth(canvas: HTMLElement, cover: HTMLElement | null | undefined): number {
  if (!cover) return 0;
  return Math.max(0, canvas.getBoundingClientRect().right - cover.getBoundingClientRect().left);
}

/** Brings each new selection into view once its items are on the map. */
function useReveal(
  cy: Core | undefined,
  selection: string[],
  elements: ElementDefinition[],
  container: RefObject<HTMLDivElement | null>,
  cover?: RefObject<HTMLElement | null>,
): void {
  const revealed = useRef("");
  // The same items in another order (as the server echoes a selection back) are not a new selection.
  const key = [...selection].sort().join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: try again when the elements arrive, but only once per selection
  useEffect(() => {
    if (!cy || !container.current || key === revealed.current) return;
    if (selection.length === 0 || reveal(cy, selection, coveredWidth(container.current, cover?.current))) revealed.current = key;
  }, [cy, key, elements]);
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
export function GraphCanvas({ elements, selection, highlight = [], found = null, onSelectionChange, tidied = 0, cover }: GraphCanvasProps) {
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
  useReveal(cy, selection, elements, container, cover);

  useEffect(() => {
    if (!cy) return;
    // Redraws must not look like the user changing the selection.
    redrawing.current = true;
    shown.current = render(cy, elements, positions.current, shown.current);
    applySelection(cy, current.current);
    redrawing.current = false;
  }, [cy, elements]);

  useEffect(() => void (cy && tidied > 0 && tidy(cy, positions.current)), [cy, tidied]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply when the elements are rebuilt
  useEffect(() => applySelection(cy, selection), [cy, selection, elements]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply when the elements are rebuilt
  useEffect(() => applyHighlight(cy, highlight), [cy, highlight, elements]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply when the elements are rebuilt
  useEffect(() => applySearch(cy, found), [cy, found, elements]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={container} className="h-full w-full" data-testid="graph-canvas" />
      {cy ? <MiniMap cy={cy} /> : null}
    </div>
  );
}
