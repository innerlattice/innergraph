// ReviewEngine: decides which proposed Events are low impact (auto-accepted) and which
// are surfaced for end-of-Session Review. Reads Roles only, never type names.
import { derivationalNodeTypes, rolesOf } from "../access/schemaAccess.js";
import type { AnyEvent, Graph, Role, Schema, VaultEvent } from "../core/types.js";
import { type Arc, hasPath } from "../utilities/graphAlgo.js";

export interface ReviewPolicy {
  /** When false, every proposed Event waits for a human. */
  autoAccept: boolean;
  /** Assertions below this Confidence are always surfaced. */
  minAutoConfidence: number;
}

export const DEFAULT_POLICY: ReviewPolicy = { autoAccept: true, minAutoConfidence: 0 };

export interface ReviewItem {
  eventId: string;
  reasons: string[];
}

export interface Triage {
  autoAccept: string[];
  review: ReviewItem[];
}

interface TriageContext {
  graph: Graph;
  events: AnyEvent[];
  roles: Record<string, Role | undefined>;
  rootTypes: Set<string>;
  policy: ReviewPolicy;
}

function arcsWithRole(ctx: TriageContext, role: Role): Arc[] {
  const proposed = ctx.events.filter((e): e is VaultEvent<"EdgeAsserted"> => e.type === "EdgeAsserted").map((e) => e.body);
  return [...Object.values(ctx.graph.edges), ...proposed].filter((e) => ctx.roles[e.type] === role);
}

function isNewRoot(ctx: TriageContext, e: VaultEvent<"NodeAsserted">): boolean {
  if (ctx.graph.nodes[e.body.id] || !ctx.rootTypes.has(e.body.type)) return false;
  return !arcsWithRole(ctx, "derivational").some((arc) => arc.to === e.body.id);
}

function closesLoop(ctx: TriageContext, e: VaultEvent<"EdgeAsserted">): boolean {
  if (ctx.roles[e.body.type] !== "causal" || ctx.graph.edges[e.body.id]) return false;
  const others = arcsWithRole(ctx, "causal").filter((arc) => arc.id !== e.body.id);
  return e.body.from === e.body.to || hasPath(others, e.body.to, e.body.from);
}

type Rule = (ctx: TriageContext, e: AnyEvent) => string | null;

const rules: Rule[] = [
  (ctx) => (ctx.policy.autoAccept ? null : "policy requires manual review"),
  (ctx, e) => (e.type === "NodeAsserted" && isNewRoot(ctx, e) ? "new root-level node" : null),
  (ctx, e) => (e.type === "EdgeAsserted" && closesLoop(ctx, e) ? "closes a feedback loop" : null),
  (_, e) => (e.type === "NodesSplit" || e.type === "NodesMerged" ? "refactor" : null),
  (_, e) => (e.type === "StatusChanged" ? "status change proposed by an agent" : null),
  (ctx, e) => (isLowConfidence(ctx, e) ? "confidence below auto-accept threshold" : null),
  (ctx, e) => (e.type === "NodeAsserted" && e.body.similarTo?.length ? `may duplicate “${similarLabel(ctx, e.body.similarTo[0])}”` : null),
];

function similarLabel(ctx: TriageContext, id: string): string {
  const pending = ctx.events.find((e): e is VaultEvent<"NodeAsserted"> => e.type === "NodeAsserted" && e.body.id === id);
  return ctx.graph.nodes[id]?.label ?? pending?.body.label ?? id;
}

function isLowConfidence(ctx: TriageContext, e: AnyEvent): boolean {
  if (e.type !== "NodeAsserted" && e.type !== "EdgeAsserted") return false;
  return e.body.confidence < ctx.policy.minAutoConfidence;
}

function reasonsFor(ctx: TriageContext, e: AnyEvent): string[] {
  return rules.map((rule) => rule(ctx, e)).filter((r): r is string => r !== null);
}

/** Held Edges keep their dependants held too, so nothing lands without its endpoints. */
function holdDependants(ctx: TriageContext, held: Map<string, string[]>): void {
  const heldNodes = new Set(
    ctx.events.filter((e) => e.type === "NodeAsserted" && held.has(e.id)).map((e) => (e as VaultEvent<"NodeAsserted">).body.id),
  );
  for (const e of ctx.events) {
    if (e.type !== "EdgeAsserted" || held.has(e.id)) continue;
    const blocked = [e.body.from, e.body.to].filter((id) => heldNodes.has(id));
    if (blocked.length > 0) held.set(e.id, ["depends on a node awaiting review"]);
  }
}

export class ReviewEngine {
  triage(events: AnyEvent[], graph: Graph, schema: Schema | null, policy: ReviewPolicy = DEFAULT_POLICY): Triage {
    const ctx: TriageContext = {
      graph,
      events,
      roles: rolesOf(schema),
      rootTypes: schema ? derivationalNodeTypes(schema) : new Set(),
      policy,
    };
    const held = new Map<string, string[]>();
    for (const e of events) {
      const reasons = reasonsFor(ctx, e);
      if (reasons.length > 0) held.set(e.id, reasons);
    }
    holdDependants(ctx, held);
    return {
      autoAccept: events.filter((e) => !held.has(e.id)).map((e) => e.id),
      review: [...held].map(([eventId, reasons]) => ({ eventId, reasons })),
    };
  }

  /** Rejecting a Node also rejects proposed Edges that would dangle without it. */
  cascadeRejections(events: AnyEvent[], rejected: string[], graph: Graph): string[] {
    const nodeIds = new Set(
      events
        .filter((e): e is VaultEvent<"NodeAsserted"> => e.type === "NodeAsserted" && rejected.includes(e.id))
        .map((e) => e.body.id)
        .filter((id) => !graph.nodes[id]),
    );
    const dangling = events.filter(
      (e) => e.type === "EdgeAsserted" && (nodeIds.has(e.body.from) || nodeIds.has(e.body.to)),
    );
    return [...new Set([...rejected, ...dangling.map((e) => e.id)])];
  }
}
