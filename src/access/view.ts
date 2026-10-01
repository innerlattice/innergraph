// The materialized View: one read model every Client renders from. Evidence is normalised
// once, and one switch decides whether removed items are materialized too ("Show removed";
// nothing else special-cases them). Items replaced by a refactor (merged or split away) are
// history only, never materialized.
import type { Evidence, GraphEdge, GraphNode, ProjectionState } from "../core/types.js";

interface ViewMeta {
  /** Evidence that pointed into earlier versions of an Entry and is no longer shown. */
  staleEvidence: number;
}

export type ViewNode = GraphNode & ViewMeta;
export type ViewEdge = GraphEdge & ViewMeta;

export interface GraphView {
  nodes: Record<string, ViewNode>;
  edges: Record<string, ViewEdge>;
  /** How many items are removed, whether or not they are shown. */
  removedCount: number;
  position: string;
  /** Nodes merged or split away, each with the nodes made from it, so old references can follow. */
  replaced: Record<string, string[]>;
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

// ---- materializing --------------------------------------------------------------------

function replacedIds(state: ProjectionState): Set<string> {
  return new Set(Object.values(state.graph.nodes).flatMap((n) => n.derivedFrom));
}

/** Each replaced node's successors: the nodes merged or split from it. */
function replacements(state: ProjectionState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const node of Object.values(state.graph.nodes)) {
    for (const source of node.derivedFrom) out[source] = [...(out[source] ?? []), node.id];
  }
  return out;
}

export function withMeta<T extends GraphNode | GraphEdge>(item: T, state: ProjectionState): T & ViewMeta {
  const { evidence, stale } = normaliseEvidence(item.evidence, state);
  return Object.assign({}, item, { evidence, staleEvidence: stale });
}

/** Every item that could be materialized. Replaced items are left out. */
function candidates(state: ProjectionState): (GraphNode | GraphEdge)[] {
  const replaced = replacedIds(state);
  const { nodes, edges } = state.graph;
  return [...Object.values(nodes), ...Object.values(edges)].filter((i) => !(i.removed && replaced.has(i.id)));
}

function isEdge(item: ViewNode | ViewEdge): item is ViewEdge {
  return "from" in item;
}

/**
 * Materializes the View: items on the map, and removed ones too when `includeRemoved`; Edges
 * only when both of their Nodes are materialized too.
 */
export function materialize(state: ProjectionState, includeRemoved = false): GraphView {
  const all = candidates(state).map((item): ViewNode | ViewEdge => ("from" in item ? withMeta(item, state) : withMeta(item, state)));
  const removedCount = all.filter((i) => i.removed).length;
  const chosen = all.filter((i) => includeRemoved || !i.removed);
  const nodes: Record<string, ViewNode> = {};
  for (const i of chosen) if (!isEdge(i)) nodes[i.id] = i;
  const edges: Record<string, ViewEdge> = {};
  for (const i of chosen) if (isEdge(i) && nodes[i.from] && nodes[i.to]) edges[i.id] = i;
  return { nodes, edges, removedCount, position: state.position, replaced: replacements(state) };
}
