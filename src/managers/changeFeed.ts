// "What changed": the Log grouped by Session, one readable row per thing touched, newest first.
// Every Session can be undone as a whole (MapManager.undoSession). Helpers for ExploreManager.
import { edgeTextIn } from "../core/edgeText.js";
import type { ActorId, AnyEvent, EventBodies, ProjectionState, VaultEvent } from "../core/types.js";

export type ChangeAction = "added" | "updated" | "renamed" | "edited" | "removed" | "restored" | "confirmed" | "unconfirmed" | "merged" | "split" | "revised";

interface ChangeRow {
  id: string;
  kind: "node" | "edge" | "entry";
  label: string;
  action: ChangeAction;
  /** Extra words: the new label, the merged sources, the split parts. */
  detail?: string;
}

export interface SessionChanges {
  session: string;
  actor: ActorId;
  purpose: string;
  at: string;
  entry?: string;
  rows: ChangeRow[];
}

interface FeedContext {
  state: ProjectionState;
  seen: Set<string>;
}

function nodeLabel(ctx: FeedContext, id: string): string {
  return ctx.state.graph.nodes[id]?.label ?? id;
}

function itemLabel(ctx: FeedContext, id: string): { kind: "node" | "edge"; label: string } {
  const edge = ctx.state.graph.edges[id];
  return edge ? { kind: "edge", label: edgeTextIn(ctx.state.graph, edge) } : { kind: "node", label: nodeLabel(ctx, id) };
}

function firstTime(ctx: FeedContext, id: string): ChangeAction {
  const seen = ctx.seen.has(id);
  ctx.seen.add(id);
  return seen ? "updated" : "added";
}

/** Taking off or putting back is what a person notices first; confirming comes after. */
function markAction(b: EventBodies["Marked"]): ChangeAction {
  if (b.removed !== undefined) return b.removed ? "removed" : "restored";
  return b.confirmed ? "confirmed" : "unconfirmed";
}

type RowMaker<K extends keyof EventBodies> = (ctx: FeedContext, e: VaultEvent<K>) => ChangeRow[];
const ROWS: { [K in keyof EventBodies]?: RowMaker<K> } = {
  EntryAdded: (_, e) => [{ id: e.body.entry, kind: "entry", label: e.body.title, action: e.body.revises ? "revised" : "added" }],
  NodeAsserted: (ctx, e) => [{ id: e.body.id, kind: "node", label: ctx.state.graph.nodes[e.body.id]?.label ?? e.body.label, action: firstTime(ctx, e.body.id) }],
  EdgeAsserted: (ctx, e) => [{ id: e.body.id, kind: "edge", label: edgeTextIn(ctx.state.graph, e.body), action: firstTime(ctx, e.body.id) }],
  AttributesChanged: (ctx, e) => [{ id: e.body.target, ...itemLabel(ctx, e.body.target), action: e.body.label ? "renamed" : "edited", detail: e.body.label }],
  Marked: (ctx, e) => [{ id: e.body.target, ...itemLabel(ctx, e.body.target), action: markAction(e.body) }],
  NodesMerged: (ctx, e) => {
    ctx.seen.add(e.body.into.id);
    return [{ id: e.body.into.id, kind: "node", label: e.body.into.label, action: "merged", detail: e.body.sources.map((id) => nodeLabel(ctx, id)).join(", ") }];
  },
  NodesSplit: (ctx, e) => {
    for (const part of e.body.into) ctx.seen.add(part.id);
    return [{ id: e.body.source, kind: "node", label: nodeLabel(ctx, e.body.source), action: "split", detail: e.body.into.map((p) => p.label).join(", ") }];
  },
};

function rowsFor(ctx: FeedContext, e: AnyEvent): ChangeRow[] {
  const make = ROWS[e.type] as RowMaker<typeof e.type> | undefined;
  return make ? make(ctx, e as never) : [];
}

export function changeFeed(events: readonly AnyEvent[], state: ProjectionState, limit = 30): SessionChanges[] {
  const ctx: FeedContext = { state, seen: new Set() };
  const sessions = new Map<string, SessionChanges>();
  for (const e of events) {
    const rows = rowsFor(ctx, e);
    const opened = e.type === "SessionOpened" ? { purpose: e.body.purpose, entry: e.body.entry } : undefined;
    if (!opened && rows.length === 0) continue;
    const group = sessions.get(e.session) ?? { session: e.session, actor: e.actor, purpose: opened?.purpose ?? "change", at: e.hlc, entry: opened?.entry, rows: [] };
    group.rows.push(...rows);
    sessions.set(e.session, group);
  }
  return [...sessions.values()]
    .filter((s) => s.rows.length > 0)
    .reverse()
    .slice(0, limit);
}
