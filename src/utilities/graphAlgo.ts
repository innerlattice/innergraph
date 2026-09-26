// Theory-free directed-graph primitives shared by Engines.

export interface Arc {
  id: string;
  from: string;
  to: string;
}

export function adjacency(arcs: Arc[], direction: "out" | "in" = "out"): Map<string, Arc[]> {
  const adj = new Map<string, Arc[]>();
  const key = direction === "out" ? "from" : "to";
  for (const arc of arcs) {
    const list = adj.get(arc[key]) ?? [];
    list.push(arc);
    adj.set(arc[key], list);
  }
  return adj;
}

export function neighbour(arc: Arc, direction: "out" | "in"): string {
  return direction === "out" ? arc.to : arc.from;
}

/** Nodes reachable from `start` (excluding `start` unless on a cycle). */
export function reachable(arcs: Arc[], start: string, direction: "out" | "in" = "out"): Set<string> {
  const adj = adjacency(arcs, direction);
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    for (const arc of adj.get(stack.pop() as string) ?? []) {
      const next = neighbour(arc, direction);
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

export function hasPath(arcs: Arc[], from: string, to: string): boolean {
  return reachable(arcs, from).has(to);
}

function tracePath(prev: Map<string, string>, to: string): string[] {
  const path = [to];
  while (prev.has(path[0])) path.unshift(prev.get(path[0]) as string);
  return path;
}

/** Breadth-first shortest node path from `from` to `to`, or null. */
export function shortestPath(arcs: Arc[], from: string, to: string): string[] | null {
  const adj = adjacency(arcs);
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const node = queue.shift() as string;
    if (node === to) return tracePath(prev, to);
    for (const arc of adj.get(node) ?? []) {
      if (seen.has(arc.to)) continue;
      seen.add(arc.to);
      prev.set(arc.to, node);
      queue.push(arc.to);
    }
  }
  return null;
}

/** Connected components ignoring direction; singletons omitted. */
export function components(arcs: Arc[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.has(x) && parent.get(x) !== x) x = parent.get(x) as string;
    return x;
  };
  for (const arc of arcs) {
    parent.set(arc.from, find(arc.from));
    parent.set(arc.to, find(arc.to));
    parent.set(find(arc.from), find(arc.to));
  }
  const groups = new Map<string, string[]>();
  for (const node of parent.keys()) groups.set(find(node), [...(groups.get(find(node)) ?? []), node]);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort());
}

interface CycleSearch {
  start: string;
  adj: Map<string, Arc[]>;
  rank: Map<string, number>;
  found: Arc[][];
  limit: number;
}

function walk(ctx: CycleSearch, node: string, path: Arc[], visited: Set<string>): void {
  for (const arc of ctx.adj.get(node) ?? []) {
    if (ctx.found.length >= ctx.limit) return;
    if (arc.to === ctx.start) {
      ctx.found.push([...path, arc]);
    } else if (canExtend(ctx, arc.to, visited)) {
      visited.add(arc.to);
      walk(ctx, arc.to, [...path, arc], visited);
      visited.delete(arc.to);
    }
  }
}

function canExtend(ctx: CycleSearch, node: string, visited: Set<string>): boolean {
  return (ctx.rank.get(node) ?? -1) > (ctx.rank.get(ctx.start) ?? -1) && !visited.has(node);
}

/** Enumerates elementary cycles, each reported once starting from its lowest-ranked node. */
export function elementaryCycles(arcs: Arc[], limit = 200): Arc[][] {
  const order = [...new Set(arcs.flatMap((a) => [a.from, a.to]))].sort();
  const rank = new Map(order.map((n, i) => [n, i] as const));
  const found: Arc[][] = [];
  const adj = adjacency(arcs);
  for (const start of order) {
    walk({ start, adj, rank, found, limit }, start, [], new Set([start]));
  }
  return found;
}
