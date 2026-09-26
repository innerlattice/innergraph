// The materialized View: one read model every Client renders from. Each Node and Edge gets
// exactly one user-facing status, evidence is normalised once, and a status filter decides
// what is materialized ("Show declined" widens the filter; nothing else special-cases it).
import type { AnyEvent, Evidence, GraphEdge, GraphNode, ProjectionState, VaultEvent } from "../core/types.js";

/**
 * - proposed: written by an Actor, not yet approved (merged as a hypothesis, or `held`
 *   for review because it is high-impact)
 * - approved: confirmed by the person
 * - parked: set aside; excluded from recall and suggestions
 * - declined: rejected or retired; kept in history, restorable
 * Items replaced by a refactor (merged or split away) are history only, never materialized.
 */
export type ViewStatus = "proposed" | "approved" | "parked" | "declined";

export const VIEW_STATUSES: readonly ViewStatus[] = ["proposed", "approved", "parked", "declined"];
export const ACTIVE: readonly ViewStatus[] = ["proposed", "approved", "parked"];

export interface ViewMeta {
  status: ViewStatus;
  /** Proposed but not merged: waiting because it is high-impact. */
  held: boolean;
  /** The Event that proposed it, while it is held. */
  proposedBy?: string;
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

// ---- pending Events ---------------------------------------------------------------

export function pendingEvents(state: ProjectionState): AnyEvent[] {
  return Object.values(state.proposals).flatMap((p) => p.events.filter((i) => i.decision === "pending").map((i) => i.event));
}

type Assertion = VaultEvent<"NodeAsserted"> | VaultEvent<"EdgeAsserted">;

function isAssertion(e: AnyEvent): e is Assertion {
  return e.type === "NodeAsserted" || e.type === "EdgeAsserted";
}

function rejectedAssertions(state: ProjectionState): Assertion[] {
  const rejected = Object.values(state.proposals).flatMap((p) => p.events.filter((i) => i.decision === "rejected").map((i) => i.event));
  return rejected.filter(isAssertion);
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

const MERGED: Record<GraphNode["status"], ViewStatus | "replaced"> = {
  hypothesis: "proposed",
  accepted: "approved",
  parked: "parked",
  superseded: "declined",
};

function replacedIds(state: ProjectionState): Set<string> {
  return new Set(Object.values(state.graph.nodes).flatMap((n) => n.derivedFrom));
}

function withMeta<T extends GraphNode | GraphEdge>(item: T, status: ViewStatus, state: ProjectionState, held?: string): Omit<T, "status"> & ViewMeta {
  const { evidence, stale } = normaliseEvidence(item.evidence, state);
  const { status: _raw, ...rest } = item;
  return { ...rest, evidence, status, held: held !== undefined, proposedBy: held, staleEvidence: stale };
}

function asItem(e: Assertion): GraphNode | GraphEdge {
  const meta = { status: "hypothesis" as const, assertedBy: e.actor, assertedAt: e.hlc, updatedAt: e.hlc };
  if (e.type === "EdgeAsserted") return { ...e.body, ...meta };
  const { similarTo: _hint, ...body } = e.body;
  return { ...body, ...meta, derivedFrom: [] };
}

interface Candidate {
  item: GraphNode | GraphEdge;
  status: ViewStatus;
  held?: string;
}

/** Every item that could be materialized, with its one status. Replaced items are left out. */
export function candidates(state: ProjectionState): Candidate[] {
  const replaced = replacedIds(state);
  const { nodes, edges } = state.graph;
  const merged = [...Object.values(nodes), ...Object.values(edges)]
    .filter((i) => !(i.status === "superseded" && replaced.has(i.id)))
    .map((item) => ({ item, status: MERGED[item.status] as ViewStatus }));
  const known = (id: string) => nodes[id] !== undefined || edges[id] !== undefined;
  const held = pendingEvents(state).filter(isAssertion).filter((e) => !known(e.body.id)).map((e) => ({ item: asItem(e), status: "proposed" as const, held: e.id }));
  const heldIds = new Set(held.map((h) => h.item.id));
  const rejected = rejectedAssertions(state).filter((e) => !known(e.body.id) && !heldIds.has(e.body.id));
  const declined = [...new Map(rejected.map((e) => [e.body.id, { item: asItem(e), status: "declined" as const }])).values()];
  return [...merged, ...held, ...declined];
}

function countStatuses(all: Candidate[]): Record<ViewStatus, number> {
  const counts = { proposed: 0, approved: 0, parked: 0, declined: 0 };
  for (const c of all) counts[c.status]++;
  return counts;
}

/**
 * Materializes the View: items whose status is in `include`, Edges only when both of their
 * Nodes are materialized too.
 */
export function materialize(state: ProjectionState, include: readonly ViewStatus[] = ACTIVE): GraphView {
  const all = candidates(state);
  const wanted = new Set(include);
  const chosen = all.filter((c) => wanted.has(c.status));
  const nodes: Record<string, ViewNode> = {};
  for (const c of chosen) if (!("from" in c.item)) nodes[c.item.id] = withMeta(c.item, c.status, state, c.held);
  const edges: Record<string, ViewEdge> = {};
  for (const c of chosen) {
    if ("from" in c.item && nodes[c.item.from] && nodes[c.item.to]) edges[c.item.id] = withMeta(c.item, c.status, state, c.held);
  }
  return { nodes, edges, counts: countStatuses(all), position: state.position };
}
