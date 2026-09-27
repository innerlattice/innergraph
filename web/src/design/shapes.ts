// SVG outlines for the node shapes Cytoscape draws, so a gem painted as the node's background
// lines up with the shape Cytoscape uses for hit-testing, outlines and rings.

type Points = number[];

/** Cytoscape's regular polygons, stretched to fill the -1..1 square. */
function ngon(sides: number): Points {
  const step = (2 * Math.PI) / sides;
  const start = Math.PI / 2 + (sides % 2 === 0 ? step / 2 : 0);
  const raw = Array.from({ length: sides }, (_, i) => [Math.cos(start + i * step), -Math.sin(start + i * step)]);
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const sx = 2 / (Math.max(...xs) - Math.min(...xs));
  const sy = 2 / (Math.max(...ys) - Math.min(...ys));
  const shift = -1 - Math.min(...ys) * sy;
  return raw.flatMap(([x, y]) => [x * sx, y * sy + Math.max(0, shift)]);
}

const POLYGONS: Record<string, Points> = {
  "round-diamond": [0, 1, 1, 0, 0, -1, -1, 0],
  "round-hexagon": ngon(6),
  "round-octagon": ngon(8),
  "round-triangle": ngon(3),
  "round-tag": [-1, -1, 0.25, -1, 1, 0, 0.25, 1, -1, 1],
  rhomboid: [-1, -1, 0.333, -1, 1, 1, -0.333, 1],
};

/** Rounds rhomboid's corners too: sharp points read as harsh next to the rest. */
const CORNER: Record<string, (w: number, h: number) => number> = {
  rhomboid: (w, h) => Math.min(w, h) / 12,
};

const f = (n: number) => Math.round(n * 100) / 100;

/** A closed path through `pts` with each corner cut by a quadratic curve of radius `r`. */
function roundedPath(pts: [number, number][], r: number): string {
  const n = pts.length;
  const toward = (a: [number, number], b: [number, number]) => {
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

function rect(w: number, h: number, rx: number, ry = rx): string {
  return `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" ry="${f(ry)}"`;
}

/** An SVG element (without its closing `/>`) drawing `shape` at w × h, centred on 0,0. */
export function shapeElement(shape: string, w: number, h: number): string {
  if (shape === "round-rectangle") return rect(w, h, Math.min(w / 4, h / 4, 8));
  if (shape === "barrel") return rect(w, h, w / 4, h / 6);
  const points = POLYGONS[shape];
  if (!points) return `<ellipse rx="${f(w / 2)}" ry="${f(h / 2)}"`;
  const pts = Array.from({ length: points.length / 2 }, (_, i): [number, number] => [(points[2 * i] * w) / 2, (points[2 * i + 1] * h) / 2]);
  const radius = (CORNER[shape] ?? ((a: number, b: number) => Math.min(a / 10, b / 10, 8)))(w, h);
  return `<path d="${roundedPath(pts, radius)}"`;
}
