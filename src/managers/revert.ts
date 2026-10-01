// Compensating Events that return items to an earlier state (git-revert style: nothing is
// removed from the Log, so a revert can itself be reverted). Helpers for MapManager.
import type { ActorId, AnyDraft, AnyEvent, Attributes, EventBodies, EventType, Graph, GraphEdge, GraphNode, ProjectionState } from "../core/types.js";
import { newId } from "../utilities/crypto.js";

type Item = GraphNode | GraphEdge;
/** An Event draft before an Actor and Session are attached. */
export type Draft = { [K in EventType]: { id?: string; type: K; body: EventBodies[K] } }[EventType];

export interface RevertPlan {
  drafts: Draft[];
  summary: { retired: number; restored: number; changed: number };
}

/** A patch that turns `now` back into `before`: changed keys restored, added keys removed. */
export function attributeRollback(before: Attributes, now: Attributes): Attributes {
  const patch: Attributes = {};
  for (const [k, v] of Object.entries(before)) if (JSON.stringify(now[k]) !== JSON.stringify(v)) patch[k] = v;
  for (const k of Object.keys(now)) if (!(k in before)) patch[k] = null;
  return patch;
}

/** An Edge as an assertion again: what it says, without its state or history. */
export function assertionOf(edge: GraphEdge): Omit<GraphEdge, "removed" | "confirmed" | "assertedBy" | "assertedAt" | "updatedAt"> {
  const { removed: _r, confirmed: _c, assertedBy: _b, assertedAt: _a, updatedAt: _u, ...body } = edge;
  return body;
}

function retire(target: string, reason: string): Draft {
  return { type: "Marked", body: { target, removed: true, reason } };
}

/** Puts `removed` and `confirmed` back as they were, when either differs. */
function stateRollback(before: Item, now: Item, reason: string): Draft[] {
  const removed = before.removed !== now.removed ? before.removed : undefined;
  const confirmed = before.confirmed !== now.confirmed ? before.confirmed : undefined;
  return removed === undefined && confirmed === undefined ? [] : [{ type: "Marked", body: { target: now.id, removed, confirmed, reason } }];
}

function fieldRollback(before: Item, now: Item): Draft[] {
  const patch = attributeRollback(before.attributes, now.attributes);
  const label = "label" in before && before.label !== (now as GraphNode).label ? before.label : undefined;
  const confidence = before.confidence !== now.confidence ? before.confidence : undefined;
  const changed = Object.keys(patch).length > 0 || label !== undefined || confidence !== undefined;
  return changed ? [{ type: "AttributesChanged", body: { target: now.id, patch, label, confidence } }] : [];
}

/** Edges moved by a refactor cannot be moved back; retire them and re-create the original. */
function endpointRollback(before: GraphEdge, now: GraphEdge, reason: string): Draft[] {
  if (before.from === now.from && before.to === now.to) return [];
  return [retire(now.id, reason), { type: "EdgeAsserted", body: { ...assertionOf(before), id: newId() } }];
}

function rollbackItem(before: Item | undefined, now: Item, reason: string): Draft[] {
  if (!before) return now.removed ? [] : [retire(now.id, reason)];
  const moved = "from" in before ? endpointRollback(before, now as GraphEdge, reason) : [];
  if (moved.length > 0) return moved;
  return [...fieldRollback(before, now), ...stateRollback(before, now, reason)];
}

function items(graph: Graph): Map<string, Item> {
  return new Map<string, Item>([...Object.entries(graph.nodes), ...Object.entries(graph.edges)]);
}

function summarise(drafts: Draft[], before: Map<string, Item>): RevertPlan["summary"] {
  const marks = drafts.filter((d): d is Extract<Draft, { type: "Marked" }> => d.type === "Marked");
  return {
    retired: marks.filter((d) => d.body.removed === true).length,
    restored: marks.filter((d) => d.body.removed === false && before.has(d.body.target)).length,
    changed: drafts.filter((d) => d.type === "AttributesChanged").length + marks.filter((d) => d.body.removed === undefined).length,
  };
}

/** Everything needed to return `only` (or every item) to how it was at `before`. */
export function planRevert(before: ProjectionState, now: ProjectionState, position: string, only?: Set<string>): RevertPlan {
  const reason = `reverted to ${position}`;
  const past = items(before.graph);
  const drafts = [...items(now.graph).values()].filter((item) => !only || only.has(item.id)).flatMap((item) => rollbackItem(past.get(item.id), item, reason));
  return { drafts, summary: summarise(drafts, past) };
}

/** Ids an Event touched, so it can be undone on its own. */
export function targetsOf(event: AnyEvent): string[] {
  const b = event.body as { target?: string; id?: string; source?: string; sources?: string[]; into?: { id: string } | { id: string }[] };
  const into = Array.isArray(b.into) ? b.into.map((p) => p.id) : b.into ? [b.into.id] : [];
  return [b.target, b.id, b.source, ...(b.sources ?? []), ...into].filter((x): x is string => Boolean(x));
}

export function withActor(drafts: Draft[], actor: ActorId, session: string): AnyDraft[] {
  return drafts.map((d) => ({ ...d, actor, session }) as AnyDraft);
}
