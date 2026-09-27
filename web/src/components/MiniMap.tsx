import type { Core } from "cytoscape";
import { type PointerEvent, useEffect, useState } from "react";
import { COLOR } from "../design/tokens";
import { type Box, fit, panToCentre, toMini, toModel, union } from "../lib/minimap";

const WIDTH = 180;
const HEIGHT = 120;
/** Below this canvas width the minimap would cover what it summarises. */
const MIN_CANVAS_WIDTH = 480;

interface Snapshot {
  nodes: { id: string; x: number; y: number; color: string; selected: boolean }[];
  edges: { id: string; x1: number; y1: number; x2: number; y2: number }[];
  view: Box;
  bounds: Box;
  width: number;
}

export function snapshot(cy: Core): Snapshot {
  const view = cy.extent();
  const graph = cy.elements().boundingBox();
  const bounds = cy.nodes().length > 0 ? union(graph, view) : view;
  return {
    nodes: cy.nodes().map((n) => ({ id: n.id(), ...n.position(), color: n.data("color") ?? COLOR.faint, selected: n.selected() })),
    edges: cy.edges().map((e) => ({ id: e.id(), x1: e.source().position().x, y1: e.source().position().y, x2: e.target().position().x, y2: e.target().position().y })),
    view,
    bounds,
    width: cy.width(),
  };
}

/** Overview of the whole graph with the current viewport; click or drag to move the view. */
export function MiniMap(props: { cy: Core }) {
  const { cy } = props;
  const [snap, setSnap] = useState<Snapshot>(() => snapshot(cy));

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSnap(snapshot(cy)));
    };
    cy.on("render viewport add remove position select unselect resize", update);
    return () => {
      cancelAnimationFrame(frame);
      cy.off("render viewport add remove position select unselect resize", update);
    };
  }, [cy]);

  if (snap.width < MIN_CANVAS_WIDTH) return null;
  const t = fit(snap.bounds, WIDTH, HEIGHT);
  const moveTo = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const model = toModel(t, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    cy.pan(panToCentre(model, cy.zoom(), { width: cy.width(), height: cy.height() }));
  };
  const v1 = toMini(t, { x: snap.view.x1, y: snap.view.y1 });
  const v2 = toMini(t, { x: snap.view.x2, y: snap.view.y2 });

  return (
    <svg
      role="img"
      aria-label="Minimap: click or drag to move the view"
      width={WIDTH}
      height={HEIGHT}
      className="absolute right-3 bottom-3 cursor-pointer rounded-xl bg-white/90 shadow-floating"
      onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), moveTo(e))}
      onPointerMove={(e) => e.buttons === 1 && moveTo(e)}
    >
      {snap.edges.map((e) => {
        const a = toMini(t, { x: e.x1, y: e.y1 });
        const b = toMini(t, { x: e.x2, y: e.y2 });
        return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLOR.rule} strokeWidth={0.8} />;
      })}
      {snap.nodes.map((n) => {
        const p = toMini(t, n);
        return <circle key={n.id} cx={p.x} cy={p.y} r={n.selected ? 3.5 : 2.5} fill={n.color} stroke={n.selected ? COLOR.deep : "none"} />;
      })}
      <rect x={v1.x} y={v1.y} width={Math.max(v2.x - v1.x, 2)} height={Math.max(v2.y - v1.y, 2)} fill={COLOR.deep} fillOpacity={0.05} stroke={COLOR.strong} strokeWidth={1} />
    </svg>
  );
}
