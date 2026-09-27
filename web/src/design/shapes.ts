// Node outlines. Each shape is a list of corners (the girdle of a cut stone), used both to draw
// the stone's facets and, softened, as its silhouette. They fill the node's w × h box the way
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
  "round-diamond": [[0, -1], [1, 0], [0, 1], [-1, 0]],
  "round-hexagon": ngon(6),
  "round-octagon": ngon(8),
  "round-triangle": ngon(3),
  "round-tag": [[-1, -1], [0.3, -1], [1, 0], [0.3, 1], [-1, 1]],
};

/** Height over width that keeps a shape regular: a hexagon or triangle squeezed into a square looks tall. */
const ASPECT: Record<string, number> = { "round-hexagon": Math.sqrt(3) / 2, "round-triangle": Math.sqrt(3) / 2 };

export function aspectOf(shape: string): number {
  return ASPECT[shape] ?? 1;
}

/** How far a rhomboid's top edge leans over its bottom one: a gentle italic, whatever the width. */
export const RHOMBOID_LEAN = 0.3;

/** A rectangle with its corners cut, like an emerald cut. `cx`, `cy`: how much of each corner goes. */
function chamfered(w: number, h: number, cx: number, cy: number): Point[] {
  const x = w / 2;
  const y = h / 2;
  return [[-x + cx, -y], [x - cx, -y], [x, -y + cy], [x, y - cy], [x - cx, y], [-x + cx, y], [-x, y - cy], [-x, -y + cy]];
}

/** The stone's corners at w × h, centred on 0,0, clockwise from the top left. */
export function cornersOf(shape: string, w: number, h: number): Point[] {
  if (shape === "round-rectangle") return chamfered(w, h, Math.min(w, h) * 0.2, Math.min(w, h) * 0.2);
  if (shape === "barrel") return chamfered(w, h, Math.min(w * 0.12, h * 0.5), h * 0.3);
  if (shape === "rhomboid") {
    const lean = (h * RHOMBOID_LEAN) / 2;
    return [[-w / 2 + 2 * lean, -h / 2], [w / 2, -h / 2], [w / 2 - 2 * lean, h / 2], [-w / 2, h / 2]];
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

/** A closed path through `pts` with each corner softened by a curve of radius `r`. */
export function roundedPath(pts: Point[], r: number): string {
  const n = pts.length;
  const toward = (a: Point, b: Point) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = Math.min(r, len / 2) / len;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const parts = pts.map((p, i) => {
    const [ax, ay] = toward(p, pts[(i + n - 1) % n]);
    const [bx, by] = toward(p, pts[(i + 1) % n]);
    return `${i === 0 ? "M" : "L"}${f(ax)},${f(ay)} Q${f(p[0])},${f(p[1])} ${f(bx)},${f(by)}`;
  });
  return `${parts.join(" ")} Z`;
}

export function polygonPath(pts: Point[]): string {
  return `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L")} Z`;
}
