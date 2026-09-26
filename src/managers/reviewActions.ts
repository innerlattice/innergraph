// Approve / decline by Node, Edge or Event id: the in-graph review workflow used by the UI
// and by agents ("approve the selected ones"). Helpers for IngestManager; not a Manager.
import type { VaultAccess } from "../access/vaultAccess.js";
import { type ActorId, type AnyDraft, type AnyEvent, type Graph, type Status, USER } from "../core/types.js";
import type { ReviewEngine } from "../engines/reviewEngine.js";
import { newId } from "../utilities/crypto.js";
import { pendingIndex } from "./pending.js";

export interface ReviewOutcome {
  merged: string[];
  rejected: string[];
  statusChanged: string[];
  skipped: string[];
}

function bySession(events: AnyEvent[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const e of events) groups.set(e.session, [...new Set([...(groups.get(e.session) ?? []), e.id])]);
  return groups;
}

/** An approved pending Edge brings along its pending endpoint Nodes, so it can land. */
function withEndpoints(events: AnyEvent[], index: Map<string, AnyEvent[]>): AnyEvent[] {
  const endpoints = events.flatMap((e) => (e.type === "EdgeAsserted" ? [e.body.from, e.body.to] : []));
  const nodes = endpoints.flatMap((id) => (index.get(id) ?? []).filter((e) => e.type === "NodeAsserted"));
  return [...new Map([...nodes, ...events].map((e) => [e.id, e])).values()];
}

function reviewDrafts(actor: ActorId, groups: Map<string, string[]>, decision: "accepted" | "rejected"): AnyDraft[] {
  return [...groups].map(([session, ids]) => ({
    actor,
    session: newId(),
    type: "ProposalReviewed" as const,
    body: { session, accepted: decision === "accepted" ? ids : [], rejected: decision === "rejected" ? ids : [] },
  }));
}

function statusOf(graph: Graph, id: string): Status | undefined {
  return (graph.nodes[id] ?? graph.edges[id])?.status;
}

/**
 * Status changes by a commit-tier agent are its own Proposal, reviewed by the same Actor,
 * so provenance stays honest and nothing waits on a human who already asked for it.
 */
function statusDrafts(actor: ActorId, targets: string[], status: Status, reason: string): AnyDraft[] {
  if (targets.length === 0) return [];
  const session = newId();
  const changes = targets.map((target) => ({ id: newId(), actor, session, type: "StatusChanged" as const, body: { target, status, reason } }));
  const review = actor === USER ? [] : reviewDrafts(actor, new Map([[session, changes.map((c) => c.id)]]), "accepted");
  return [{ actor, session, type: "SessionOpened", body: { purpose: "review" } }, ...changes, { actor, session, type: "SessionClosed", body: {} }, ...review];
}

function movable(graph: Graph, id: string, actor: ActorId, from: Status[]): boolean {
  const status = statusOf(graph, id);
  if (status === "parked" && actor !== USER) return false;
  return status !== undefined && from.includes(status);
}

function appendIfAny(vault: VaultAccess, drafts: AnyDraft[]): void {
  if (drafts.length > 0) vault.append(drafts);
}

export function approve(vault: VaultAccess, ids: string[], actor: ActorId): ReviewOutcome {
  const index = pendingIndex(vault.state());
  const merging = withEndpoints(ids.flatMap((id) => index.get(id) ?? []), index);
  if (merging.length > 0) vault.append(reviewDrafts(actor, bySession(merging), "accepted"));
  const graph = vault.state().graph;
  const targets = ids.filter((id) => movable(graph, id, actor, ["hypothesis", "parked"]));
  appendIfAny(vault, statusDrafts(actor, targets, "accepted", "approved"));
  return { merged: merging.map((e) => e.id), rejected: [], statusChanged: targets, skipped: ids.filter((id) => !index.has(id) && !targets.includes(id)) };
}

export function decline(vault: VaultAccess, review: ReviewEngine, ids: string[], actor: ActorId): ReviewOutcome {
  const state = vault.state();
  const index = pendingIndex(state);
  const pending = [...new Map([...index.values()].flat().map((e) => [e.id, e])).values()];
  const chosen = ids.flatMap((id) => index.get(id) ?? []).map((e) => e.id);
  const rejected = review.cascadeRejections(pending, chosen, state.graph);
  const rejectedEvents = pending.filter((e) => rejected.includes(e.id));
  if (rejectedEvents.length > 0) vault.append(reviewDrafts(actor, bySession(rejectedEvents), "rejected"));
  const targets = ids.filter((id) => movable(vault.state().graph, id, actor, ["hypothesis", "accepted"]));
  appendIfAny(vault, statusDrafts(actor, targets, "superseded", "declined"));
  return { merged: [], rejected, statusChanged: targets, skipped: ids.filter((id) => !index.has(id) && !targets.includes(id)) };
}
