// Read helpers over pending (unreviewed) Events in the Projection. Shared by Managers; not a Manager.
import type { AnyEvent, GraphEdge, GraphNode, ProjectionState, VaultEvent } from "../core/types.js";

export interface PendingAssertion {
  eventId: string;
  session: string;
  kind: "node" | "edge";
  item: GraphNode | GraphEdge;
}

export function pendingEvents(state: ProjectionState): AnyEvent[] {
  return Object.values(state.proposals).flatMap((p) => p.events.filter((i) => i.decision === "pending").map((i) => i.event));
}

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
