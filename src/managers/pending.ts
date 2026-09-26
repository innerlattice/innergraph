// Read helpers over pending (unreviewed) Events in the Projection. Shared by Managers; not a Manager.
import { pendingEvents } from "../access/view.js";
import type { AnyEvent, GraphEdge, GraphNode, ProjectionState, VaultEvent } from "../core/types.js";
import type { ReviewEngine, ReviewPolicy } from "../engines/reviewEngine.js";

export interface PendingAssertion {
  eventId: string;
  session: string;
  kind: "node" | "edge";
  item: GraphNode | GraphEdge;
}

export { pendingEvents } from "../access/view.js";

function asItem(e: VaultEvent<"NodeAsserted"> | VaultEvent<"EdgeAsserted">): GraphNode | GraphEdge {
  const meta = { status: "hypothesis" as const, assertedBy: e.actor, assertedAt: e.hlc, updatedAt: e.hlc };
  return e.type === "NodeAsserted" ? { ...e.body, ...meta, derivedFrom: [] } : { ...e.body, ...meta };
}

/** Pending assertions of Nodes/Edges that do not exist in the Graph yet (shown as proposed). */
export function pendingAssertions(state: ProjectionState): PendingAssertion[] {
  const { nodes, edges } = state.graph;
  return pendingEvents(state)
    .filter((e): e is VaultEvent<"NodeAsserted"> | VaultEvent<"EdgeAsserted"> => e.type === "NodeAsserted" || e.type === "EdgeAsserted")
    .filter((e) => !nodes[e.body.id] && !edges[e.body.id])
    .map((e) => ({ eventId: e.id, session: e.session, kind: e.type === "NodeAsserted" ? "node" : "edge", item: asItem(e) }));
}

/** Pending Events addressable by the Node/Edge id they assert, or by their own Event id. */
export function pendingIndex(state: ProjectionState): Map<string, AnyEvent[]> {
  const index = new Map<string, AnyEvent[]>();
  const add = (key: string, e: AnyEvent) => index.set(key, [...(index.get(key) ?? []), e]);
  for (const e of pendingEvents(state)) {
    add(e.id, e);
    if (e.type === "NodeAsserted" || e.type === "EdgeAsserted") add(e.body.id, e);
  }
  return index;
}

/** Why each pending Event is waiting, per the review policy. */
export function reviewReasons(state: ProjectionState, review: ReviewEngine, policy: ReviewPolicy): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  for (const proposal of Object.values(state.proposals)) {
    const pending = proposal.events.filter((i) => i.decision === "pending").map((i) => i.event);
    if (pending.length === 0) continue;
    for (const r of review.triage(pending, state.graph, state.schema, policy).review) reasons.set(r.eventId, r.reasons);
  }
  return reasons;
}

/** Items a pending change is about: its target, refactor sources, or a re-asserted id. */
export function changeTargets(e: AnyEvent, state: ProjectionState): string[] {
  const b = e.body as { target?: string; source?: string; sources?: string[]; id?: string };
  const reasserted = b.id && (state.graph.nodes[b.id] || state.graph.edges[b.id]) ? [b.id] : [];
  return [b.target, b.source, ...(b.sources ?? []), ...reasserted].filter((x): x is string => Boolean(x));
}
