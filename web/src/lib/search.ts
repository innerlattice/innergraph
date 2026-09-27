// Finding things on the map by name, like the search on a skill tree: what matches lights up
// and everything else fades back.
import { humanise } from "../../../src/core/edgeText";
import type { ViewEdge, ViewNode } from "../api";

/**
 * The ids a search for `query` finds, or null when there is nothing to search for. A node is
 * found by its title or its kind; a link by its kind, or when both its ends are found.
 */
export function searchHits(view: { nodes: Record<string, ViewNode>; edges: Record<string, ViewEdge> }, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const has = (text: string) => text.toLowerCase().includes(q);
  const hits = new Set(
    Object.values(view.nodes)
      .filter((n) => has(`${n.label} ${humanise(n.type)}`))
      .map((n) => n.id),
  );
  for (const e of Object.values(view.edges)) if (has(humanise(e.type)) || (hits.has(e.from) && hits.has(e.to))) hits.add(e.id);
  return hits;
}
