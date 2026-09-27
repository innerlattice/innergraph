// Items merged or split away leave the map, but chat cards, entries and history still name them.
// Following each one to what it became keeps those references working.
import type { GraphView } from "../api";

type Shown = Pick<GraphView, "nodes" | "edges" | "replaced">;

/** What `id` is now: itself while on the map, else the nodes it was merged or split into. */
export function successorsOf(view: Shown, id: string, seen = new Set<string>()): string[] {
  if (view.nodes[id] || view.edges[id]) return [id];
  if (seen.has(id)) return [];
  seen.add(id);
  return (view.replaced?.[id] ?? []).flatMap((next) => successorsOf(view, next, seen));
}

/** `ids` as they are on the map now, each once. Ids that lead nowhere are kept as they are. */
export function currentIds(view: Shown | undefined, ids: string[]): string[] {
  if (!view) return ids;
  return [...new Set(ids.flatMap((id) => (view.replaced?.[id] ? successorsOf(view, id) : [id])))];
}
