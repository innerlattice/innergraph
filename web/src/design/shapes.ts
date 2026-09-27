// Node outlines. Each shape is a list of corners (the girdle of a cut stone), used both to draw
// the stone's facets and as its crisp silhouette. They fill the node's w × h box the way
// Cytoscape's shapes do, so hit-testing, outlines and underlays line up with the drawing.

export type Point = [number, number];

/** A regular polygon stretched to fill the -1..1 square, as Cytoscape draws them. */
function ngon(sides: number): Point[] {
  const step = (2 * Math.PI) / sides;
  const start = Math.PI / 2 + (sides % 2 === 0 ? step / 2 : 0);
  const raw = Array.from({ length: sides }, (_, i): Point => [Math.cos(start + i * step), -Math.sin(start + i * step)]);
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const sx = 2 / (Math.max(...xs) - Math.min(...xs));
  const sy = 2 / (Math.max(...ys) - Math.min(...ys));
  const shift = -1 - Math.min(...ys) * sy;
  return raw.map(([x, y]) => [x * sx, y * sy + Math.max(0, shift)]);
}

/** Corners on the unit square, clockwise from the top. */
const UNIT: Record<string, Point[]> = {
  "round-diamond": [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ],
  "round-hexagon": ngon(6),
  "round-octagon": ngon(8),
  "round-triangle": ngon(3),
  "round-pentagon": ngon(5),
  "round-tag": [
    [-1, -1],
    [0.3, -1],
    [1, 0],
    [0.3, 1],
    [-1, 1],
  ],
};

/** Height over width that keeps a shape regular: a hexagon or triangle squeezed into a square looks tall. */
const ASPECT: Record<string, number> = { "round-hexagon": Math.sqrt(3) / 2, "round-triangle": Math.sqrt(3) / 2, "round-pentagon": 0.95 };

export function aspectOf(shape: string): number {
  return ASPECT[shape] ?? 1;
}

/** How far a rhomboid's top edge leans over its bottom one: a gentle italic, whatever the width. */
export const RHOMBOID_LEAN = 0.3;

/** A rectangle with its corners cut, like an emerald cut. `cx`, `cy`: how much of each corner goes. */
function chamfered(w: number, h: number, cx: number, cy: number): Point[] {
  const x = w / 2;
  const y = h / 2;
  return [
    [-x + cx, -y],
    [x - cx, -y],
    [x, -y + cy],
    [x, y - cy],
    [x - cx, y],
    [-x + cx, y],
    [-x, y - cy],
    [-x, -y + cy],
  ];
}

/** The stone's corners at w × h, centred on 0,0, clockwise from the top left. */
export function cornersOf(shape: string, w: number, h: number): Point[] {
  if (shape === "round-rectangle") return chamfered(w, h, Math.min(w, h) * 0.2, Math.min(w, h) * 0.2);
  if (shape === "barrel") return chamfered(w, h, Math.min(w * 0.12, h * 0.5), h * 0.3);
  if (shape === "rhomboid") {
    const lean = (h * RHOMBOID_LEAN) / 2;
    return [
      [-w / 2 + 2 * lean, -h / 2],
      [w / 2, -h / 2],
      [w / 2 - 2 * lean, h / 2],
      [-w / 2, h / 2],
    ];
  }
  const unit = UNIT[shape];
  if (unit) return unit.map(([x, y]) => [(x * w) / 2, (y * h) / 2]);
  // An ellipse: a round brilliant with ten sides.
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return [(Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2];
  });
}

const f = (n: number) => Math.round(n * 100) / 100;

/** How far the nearest edge of a convex outline lies from its centre. */
export function inradius(pts: Point[]): number {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return Math.min(
    ...pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length];
      return Math.abs((b[0] - a[0]) * (a[1] - cy) - (a[0] - cx) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    }),
  );
}

/** A convex outline with every edge moved inward by the same distance `d`, so a bevel is even all round. */
export function inset(pts: Point[], d: number): Point[] {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  // Each edge as a line n·p = c with its normal pointing inward, then pulled in by d.
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let [nx, ny] = [(a[1] - b[1]) / len, (b[0] - a[0]) / len];
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) [nx, ny] = [-nx, -ny];
    return { nx, ny, c: nx * a[0] + ny * a[1] + d };
  });
  // Corner i is where the edge before it meets the edge after it.
  return pts.map((_, i) => {
    const p = lines[(i + n - 1) % n];
    const q = lines[i];
    const det = p.nx * q.ny - p.ny * q.nx;
    return [(p.c * q.ny - p.ny * q.c) / det, (p.nx * q.c - p.c * q.nx) / det];
  });
}

export function polygonPath(pts: Point[]): string {
  return `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L")} Z`;
}
