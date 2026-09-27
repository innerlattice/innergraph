// Bringing what was just picked into view, clear of the panel that opens over the map's right
// side. The map moves as little as it can: already in the clear, it stays put; otherwise it pans
// just enough. It only zooms out, and only for a selection of several that can't fit as it is.
import type { Core } from "cytoscape";

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Viewport {
  zoom: number;
  pan: { x: number; y: number };
}

/** Room kept between what is revealed and the edges of the clear area. */
const MARGIN = 32;
/** Below this much clear width the panel covers nearly everything, so it is ignored. */
const MIN_CLEAR = 160;
const DURATION = 250;
/** Where the map's current move is heading and when it gets there, kept in Cytoscape's scratch. */
const HEADING = "_revealHeading";

interface Heading extends Viewport {
  until: number;
}

/** How far to shift `lo..hi` so it sits inside `min..max`: nothing if it already does. */
function shift(lo: number, hi: number, min: number, max: number): number {
  if (hi - lo > max - min) return (min + max) / 2 - (lo + hi) / 2;
  if (lo < min) return min - lo;
  return hi > max ? max - hi : 0;
}

/**
 * Where the viewport should go so `model` (a box in graph coordinates) shows inside `clear` (a box
 * in screen pixels), or null when it already does.
 */
export function revealViewport(model: Box, current: Viewport, clear: Box, zoomOut: boolean): Viewport | null {
  const fit = Math.min((clear.x2 - clear.x1) / (model.x2 - model.x1 || 1), (clear.y2 - clear.y1) / (model.y2 - model.y1 || 1));
  const zoom = zoomOut && fit < current.zoom ? fit : current.zoom;
  const at = (v: number, pan: number) => v * zoom + pan;
  const dx = shift(at(model.x1, current.pan.x), at(model.x2, current.pan.x), clear.x1, clear.x2);
  const dy = shift(at(model.y1, current.pan.y), at(model.y2, current.pan.y), clear.y1, clear.y2);
  if (zoom === current.zoom && Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  if (zoom !== current.zoom) {
    // Zooming out: centre it in the clear area.
    const cx = (clear.x1 + clear.x2) / 2 - ((model.x1 + model.x2) / 2) * zoom;
    const cy = (clear.y1 + clear.y2) / 2 - ((model.y1 + model.y2) / 2) * zoom;
    return { zoom, pan: { x: cx, y: cy } };
  }
  return { zoom, pan: { x: current.pan.x + dx, y: current.pan.y + dy } };
}

/** Animates the map so `ids` show clear of `covered` pixels on its right. False when none are on the map. */
export function reveal(cy: Core, ids: string[], covered: number): boolean {
  const wanted = new Set(ids);
  const eles = cy.elements().filter((el) => wanted.has(el.id()));
  if (eles.empty()) return false;
  const width = cy.width();
  const right = width - covered < MIN_CLEAR ? width : width - covered;
  const clear = { x1: MARGIN, y1: MARGIN, x2: right - MARGIN, y2: cy.height() - MARGIN };
  // Measured from where a move under way will end, so asking again mid-move finds nothing to do.
  const heading: Heading | undefined = cy.scratch(HEADING);
  const from = heading && performance.now() < heading.until ? heading : { zoom: cy.zoom(), pan: cy.pan() };
  const next = revealViewport(eles.boundingBox({}), from, clear, ids.length > 1);
  if (!next) return true;
  // One move at a time: a new one replaces any still under way rather than queueing after it.
  cy.stop(true);
  cy.scratch(HEADING, { ...next, until: performance.now() + DURATION });
  cy.animate({ ...next }, { duration: DURATION, easing: "ease-in-out-cubic", queue: false });
  return true;
}
