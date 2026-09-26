// The materialized View: one read model every Client renders from. Each Node and Edge gets
// exactly one user-facing status, evidence is normalised once, and a status filter decides
// what is materialized ("Show declined" widens the filter; nothing else special-cases it).
import type { AnyEvent, Evidence, GraphEdge, GraphNode, ProjectionState, VaultEvent } from "../core/types.js";

/**
 * - active: on the map (`confirmed` when the person has said it is right)
 * - removed: taken off the map; kept in history, restorable
 * Items replaced by a refactor (merged or split away) are history only, never materialized.
 */
export type ViewStatus = "active" | "removed";

export const VIEW_STATUSES: readonly ViewStatus[] = ["active", "removed"];
export const ACTIVE: readonly ViewStatus[] = ["active"];

export interface ViewMeta {
  status: ViewStatus;
  /** The person confirmed it (or wrote it themselves). */
  confirmed: boolean;
  /** Evidence that pointed into earlier versions of an Entry and is no longer shown. */
  staleEvidence: number;
}

export type ViewNode = Omit<GraphNode, "status"> & ViewMeta;
export type ViewEdge = Omit<GraphEdge, "status"> & ViewMeta;

export interface GraphView {
  nodes: Record<string, ViewNode>;
  edges: Record<string, ViewEdge>;
  /** How many items have each status, whatever the filter. */
  counts: Record<ViewStatus, number>;
  position: string;
}

// ---- evidence ------------------------------------------------------------------------

function overlapShare(a: Evidence, b: Evidence): number {
  if (a.entry !== b.entry) return 0;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return overlap / Math.min(a.end - a.start, b.end - b.start);
}

/**
 * Evidence as it should be shown: only passages in the current version of each Entry,
 * and one passage where several quote (almost) the same text: the longest wins.
 */
export function normaliseEvidence(evidence: Evidence[], state: ProjectionState): { evidence: Evidence[]; stale: number } {
  const current = evidence.filter((e) => !state.entries[e.entry]?.revisedBy);
  const longestFirst = [...current].sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept: Evidence[] = [];
  for (const e of longestFirst) if (!kept.some((k) => overlapShare(k, e) >= 0.5)) kept.push(e);
  return { evidence: kept.sort((a, b) => a.entry.localeCompare(b.entry) || a.start - b.start), stale: evidence.length - current.length };
}

// ---- status ---------------------------------------------------------------------------

function replacedIds(state: ProjectionState): Set<string> {
  return new Set(Object.values(state.graph.nodes).flatMap((n) => n.derivedFrom));
}

function withMeta<T extends GraphNode | GraphEdge>(item: T, state: ProjectionState): Omit<T, "status"> & ViewMeta {
  const { evidence, stale } = normaliseEvidence(item.evidence, state);
  const { status, ...rest } = item;
  return { ...rest, evidence, status: status === "superseded" ? "removed" : "active", confirmed: status === "accepted", staleEvidence: stale };
}

/** Every item that could be materialized. Replaced items are left out. */
export function candidates(state: ProjectionState): (GraphNode | GraphEdge)[] {
  const replaced = replacedIds(state);
  const { nodes, edges } = state.graph;
  return [...Object.values(nodes), ...Object.values(edges)].filter((i) => !(i.status === "superseded" && replaced.has(i.id)));
}

function isEdge(item: ViewNode | ViewEdge): item is ViewEdge {
  return "from" in item;
}

/**
 * Materializes the View: items whose status is in `include`, Edges only when both of their
 * Nodes are materialized too.
 */
export function materialize(state: ProjectionState, include: readonly ViewStatus[] = ACTIVE): GraphView {
  const all = candidates(state).map((item): ViewNode | ViewEdge => ("from" in item ? withMeta(item, state) : withMeta(item, state)));
  const counts = { active: 0, removed: 0 };
  for (const item of all) counts[item.status]++;
  const wanted = new Set(include);
  const chosen = all.filter((i) => wanted.has(i.status));
  const nodes: Record<string, ViewNode> = {};
  for (const i of chosen) if (!isEdge(i)) nodes[i.id] = i;
  const edges: Record<string, ViewEdge> = {};
  for (const i of chosen) if (isEdge(i) && nodes[i.from] && nodes[i.to]) edges[i.id] = i;
  return { nodes, edges, counts, position: state.position };
}
