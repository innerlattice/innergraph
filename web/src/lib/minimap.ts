// Geometry for the minimap: maps graph model coordinates into a small fixed-size box.

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Transform {
  scale: number;
  dx: number;
  dy: number;
}

const PAD = 6;

export function union(a: Box, b: Box): Box {
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}

/** Scales and centres `bounds` inside a width x height box. */
export function fit(bounds: Box, width: number, height: number): Transform {
  const w = Math.max(bounds.x2 - bounds.x1, 1);
  const h = Math.max(bounds.y2 - bounds.y1, 1);
  const scale = Math.min((width - 2 * PAD) / w, (height - 2 * PAD) / h);
  return { scale, dx: (width - w * scale) / 2 - bounds.x1 * scale, dy: (height - h * scale) / 2 - bounds.y1 * scale };
}

export function toMini(t: Transform, p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * t.scale + t.dx, y: p.y * t.scale + t.dy };
}

export function toModel(t: Transform, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - t.dx) / t.scale, y: (p.y - t.dy) / t.scale };
}

/** The pan that puts model point `p` at the centre of a viewport of the given size. */
export function panToCentre(p: { x: number; y: number }, zoom: number, viewport: { width: number; height: number }) {
  return { x: viewport.width / 2 - p.x * zoom, y: viewport.height / 2 - p.y * zoom };
}
