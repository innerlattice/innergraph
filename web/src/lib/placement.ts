// Where nodes go. A new node starts beside the nodes it links to, the force layout settles it with
// everything already placed pinned, and a last pass nudges it clear of anything it overlaps. Nodes
// the viewer has already seen never move, so the map stays familiar.

export interface Point {
  x: number;
  y: number;
}

/** A node's footprint, label included: centre and size. */
export interface Box extends Point {
  id: string;
  w: number;
  h: number;
}

/** Clear space between two footprints. */
export const GAP = 14;
/** How far from its neighbours a new node starts. */
const REACH = 63;
/** Turns successive starts round a point so they spread evenly rather than stack. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const around = (centre: Point, radius: number, turn: number): Point => ({
  x: centre.x + radius * Math.cos(turn * GOLDEN_ANGLE),
  y: centre.y + radius * Math.sin(turn * GOLDEN_ANGLE),
});

function centroid(points: Point[]): Point {
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

/** The middle of the placed nodes and a radius that clears them all. */
function extent(points: Point[]): { centre: Point; radius: number } {
  const centre = centroid(points);
  return { centre, radius: Math.max(...points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))) };
}

/**
 * A starting point for each new node: beside the placed nodes it links to (new nodes linked only to
 * other new nodes follow them in), or, linked to nothing placed, just outside the map. Returns
 * nothing when nothing is placed yet; the first layout starts from scratch.
 */
export function seed(fresh: string[], neighbours: (id: string) => string[], placed: ReadonlyMap<string, Point>): Map<string, Point> {
  const starts = new Map<string, Point>();
  if (placed.size === 0) return starts;
  const at = (id: string) => placed.get(id) ?? starts.get(id);
  let waiting = fresh;
  for (let progress = true; progress && waiting.length > 0; ) {
    const before = waiting.length;
    waiting = waiting.filter((id) => {
      const anchors = neighbours(id)
        .map(at)
        .filter((p): p is Point => p !== undefined);
      if (anchors.length > 0) starts.set(id, around(centroid(anchors), REACH, starts.size + 1));
      return anchors.length === 0;
    });
    progress = waiting.length < before;
  }
  const { centre, radius } = extent([...placed.values()]);
  for (const id of waiting) starts.set(id, around(centre, radius + REACH, starts.size + 1));
  return starts;
}

/** How far two footprints must move apart on each axis to leave a gap between them (<= 0: already clear). */
function overlap(p: Box, q: Box, gap: number): Point {
  return { x: (p.w + q.w) / 2 + gap - Math.abs(p.x - q.x), y: (p.h + q.h) / 2 + gap - Math.abs(p.y - q.y) };
}

/** Moves one pair apart along the axis that needs less movement, sharing it when both may move. */
function push(p: Box, q: Box, need: Point, movable: ReadonlySet<string>): void {
  const [mp, mq] = [movable.has(p.id), movable.has(q.id)];
  const share = mp && mq ? 0.5 : 1;
  const axis = need.x < need.y ? "x" : "y";
  const side = Math.sign(q[axis] - p[axis]) || 1;
  if (mp) p[axis] -= side * need[axis] * share;
  if (mq) q[axis] += side * need[axis] * share;
}

/** One sweep over every pair; true if anything moved. */
function sweep(boxes: Box[], movable: ReadonlySet<string>, gap: number): boolean {
  let moved = false;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [p, q] = [boxes[i], boxes[j]];
      if (!movable.has(p.id) && !movable.has(q.id)) continue;
      const need = overlap(p, q, gap);
      if (need.x <= 0 || need.y <= 0) continue;
      push(p, q, need, movable);
      moved = true;
    }
  }
  return moved;
}

/** Pushes the movable footprints apart until none overlaps another. Fixed ones stay put. Returns the new centres of the movable ones. */
export function separate(boxes: Box[], movable: ReadonlySet<string>, gap = GAP, rounds = 80): Map<string, Point> {
  const working = boxes.map((b) => ({ ...b }));
  for (let round = 0; round < rounds && sweep(working, movable, gap); round++);
  return new Map(working.filter((b) => movable.has(b.id)).map((b) => [b.id, { x: b.x, y: b.y }]));
}
