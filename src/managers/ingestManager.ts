// IngestManager: Entry in -> Session -> InterpretationEngine -> Proposal -> ReviewEngine -> commit.
import { type RawInput, normalise } from "../access/ingestAccess.js";
import type { SchemaAccess } from "../access/schemaAccess.js";
import type { VaultAccess } from "../access/vaultAccess.js";
import {
  type ActorId,
  type AnyDraft,
  type AnyEvent,
  type Decision,
  type GraphEdge,
  type GraphNode,
  type ProjectionState,
  type Proposal,
  REVIEW_POLICY_ACTOR,
  USER,
} from "../core/types.js";
import type { CitedItem, ContextNode, InterpretInput, Interpretation, InterpretationEngine, Revision } from "../engines/interpretationEngine.js";
import type { RecallEngine } from "../engines/recallEngine.js";
import { DEFAULT_POLICY, type ReviewEngine, type ReviewPolicy } from "../engines/reviewEngine.js";
import { newId, utf8 } from "../utilities/crypto.js";
import type { Job, JobQueue } from "../utilities/jobQueue.js";
import { type RelatedItem, buildCorpus, describeMatches } from "./recallCorpus.js";
import { pendingAssertions } from "./pending.js";
import { citedItems, citedSpans, computeRemap } from "./revision.js";
import { type ReviewOutcome, approve, decline } from "./reviewActions.js";
import { NotFoundError, requireFound, runSession } from "./sessions.js";

export interface IngestDeps {
  vault: VaultAccess;
  schemas: SchemaAccess;
  interpretation: InterpretationEngine;
  review: ReviewEngine;
  recall: RecallEngine;
  queue: JobQueue;
  policy?: ReviewPolicy;
}

export interface IngestResult {
  session: string;
  entry: string;
  related: RelatedItem[];
  job?: Job;
}

export interface ReviewDecision {
  accept?: string[];
  reject?: string[];
  amend?: { eventId: string; patch?: Record<string, unknown>; label?: string; confidence?: number }[];
}

export interface ProposalItem {
  event: AnyEvent;
  decision: Decision;
  reasons: string[];
}

export interface ProposalView extends Omit<Proposal, "events"> {
  entryTitle?: string;
  pending: number;
  items: ProposalItem[];
}

export interface PendingItem {
  eventId: string;
  session: string;
  kind: "node" | "edge";
  item: GraphNode | GraphEdge;
  reasons: string[];
}

export interface PendingChanges {
  /** Proposed Nodes/Edges not yet in the Graph, drawn as ghosts. */
  assertions: PendingItem[];
  /** Other waiting Events (refactors, status changes, re-assertions). */
  other: ProposalItem[];
}

export interface ProposeResult {
  session: string;
  accepted: string[];
  awaitingReview: string[];
  dropped: string[];
}

function graphDrafts(result: Interpretation, actor: ActorId, session: string): AnyDraft[] {
  return [
    ...result.nodes.map((body) => ({ actor, session, type: "NodeAsserted" as const, body })),
    ...result.edges.map((body) => ({ actor, session, type: "EdgeAsserted" as const, body })),
  ];
}

export interface Amendment {
  id: string;
  label?: string;
  attributes?: Record<string, unknown>;
}

export interface RevisionResult {
  session: string;
  entry: string;
  previous: string;
  /** How many cited passages were found again in the new text. */
  remapped: number;
  /** Items that cite the entry, with their old passages; `moved: false` means the passage changed. */
  cited: CitedItem[];
  job?: Job;
}

function amendmentDraft(change: Amendment, actor: ActorId, session: string): AnyDraft {
  return { actor, session, type: "AttributesChanged", body: { target: change.id, patch: change.attributes ?? {}, label: change.label } };
}

function revisionDrafts(revision: Revision, actor: ActorId, session: string): AnyDraft[] {
  const retractions = revision.retract.map((target) => ({
    actor,
    session,
    type: "StatusChanged" as const,
    body: { target, status: "superseded" as const, reason: "no longer supported by the edited entry" },
  }));
  return [...revision.updates.map((u) => amendmentDraft(u, actor, session)), ...retractions, ...graphDrafts(revision.added, actor, session)];
}

function contextNodes(state: ProjectionState): ContextNode[] {
  return Object.values(state.graph.nodes)
    .filter((n) => n.status === "hypothesis" || n.status === "accepted")
    .map(({ id, type, label }) => ({ id, type, label }));
}

function pendingEvents(proposal: Proposal): AnyEvent[] {
  return proposal.events.filter((item) => item.decision === "pending").map((item) => item.event);
}

export class IngestManager {
  private readonly policy: ReviewPolicy;

  constructor(private readonly deps: IngestDeps) {
    this.policy = deps.policy ?? DEFAULT_POLICY;
  }

  addEntry(input: RawInput, options: { interpret?: boolean; actor?: ActorId } = {}): IngestResult {
    const { vault } = this.deps;
    const entry = normalise(input);
    const bytes = utf8(entry.text);
    const hash = vault.putBlob(bytes, entry.media);
    const session = newId();
    const actor = options.actor ?? USER;
    vault.append([
      { actor, session, type: "SessionOpened", body: { purpose: "ingest", entry: hash } },
      { actor, session, type: "EntryAdded", body: { entry: hash, source: entry.source, title: entry.title, bytes: bytes.length } },
    ]);
    const related = this.related(entry.text, [hash]);
    const job = options.interpret === false ? this.close(session, actor) : this.enqueueInterpretation(session, hash);
    return { session, entry: hash, related, job };
  }

  /**
   * Edit an Entry: stores a revision (Entries stay immutable), moves Evidence to the same
   * passages in the new text and, unless told not to, lets the model update cited items.
   */
  reviseEntry(entry: string, content: string, options: { interpret?: boolean; actor?: ActorId } = {}): RevisionResult {
    const { vault } = this.deps;
    const state = vault.state();
    const previous = requireFound(state.entries[entry], `Entry ${entry}`);
    if (previous.revisedBy) throw new Error("Edit the latest version of this Entry");
    const next = normalise({ content, title: previous.title, source: previous.source });
    const bytes = utf8(next.text);
    const hash = vault.putBlob(bytes, next.media);
    if (hash === entry) throw new Error("The Entry is unchanged");
    const remap = computeRemap(vault, entry, hash, next.text, citedSpans(state, entry));
    const cited = citedItems(vault, state, entry, remap);
    const session = newId();
    const actor = options.actor ?? USER;
    vault.append([
      { actor, session, type: "SessionOpened", body: { purpose: "revise", entry: hash } },
      { actor, session, type: "EntryAdded", body: { entry: hash, source: next.source, title: next.title, bytes: bytes.length, revises: entry, remap } },
    ]);
    const job = options.interpret === false ? this.close(session, actor) : this.enqueueRevision(session, entry, hash, cited);
    return { session, entry: hash, previous: entry, remapped: remap.length, cited, job };
  }

  /** Label/attribute corrections by any Actor; low impact, so the review policy usually merges them. */
  amend(actor: ActorId, changes: Amendment[]): ProposeResult {
    const known = this.deps.vault.state().graph;
    const valid = changes.filter((c) => known.nodes[c.id] || known.edges[c.id]);
    const { session } = runSession(this.deps.vault, actor, "amend", (s) => valid.map((c) => amendmentDraft(c, actor, s)));
    const accepted = actor === USER ? [] : this.autoReview(session);
    const dropped = changes.filter((c) => !valid.includes(c)).map((c) => `${c.id}: not found`);
    const pending = this.deps.vault.state().proposals[session].events.filter((i) => i.decision === "pending");
    return { session, accepted, awaitingReview: pending.map((i) => i.event.id), dropped };
  }

  related(text: string, exclude: string[] = []): RelatedItem[] {
    const state = this.deps.vault.state();
    const matches = this.deps.recall.recall(text, buildCorpus(this.deps.vault, state), { exclude });
    return describeMatches(this.deps.vault, state, matches);
  }

  /** An external agent proposes assertions citing quotes from an existing Entry. */
  propose(actor: ActorId, entry: string, raw: unknown): ProposeResult {
    const result = this.deps.interpretation.check(raw, this.interpretInput(entry));
    const { session } = runSession(this.deps.vault, actor, "propose", (s) => graphDrafts(result, actor, s));
    const accepted = this.autoReview(session);
    const events = this.deps.vault.state().proposals[session].events;
    const awaitingReview = events.filter((i) => i.decision === "pending").map((i) => i.event.id);
    return { session, accepted, awaitingReview, dropped: result.dropped };
  }

  review(session: string, decision: ReviewDecision, actor: ActorId = USER): ProposalView {
    const { vault, review } = this.deps;
    const state = vault.state();
    const proposal = requireFound(state.proposals[session], `Proposal ${session}`);
    const pending = pendingEvents(proposal);
    const pendingIds = new Set(pending.map((e) => e.id));
    const amend = (decision.amend ?? []).filter((a) => pendingIds.has(a.eventId));
    const accepted = [...(decision.accept ?? []), ...amend.map((a) => a.eventId)].filter((id) => pendingIds.has(id));
    const rejected = review.cascadeRejections(pending, (decision.reject ?? []).filter((id) => pendingIds.has(id)), state.graph);
    vault.append([
      { actor, session: newId(), type: "ProposalReviewed", body: { session, accepted: accepted.filter((id) => !rejected.includes(id)), rejected } },
      ...amend.map((a) => this.amendment(pending, a, actor)),
    ]);
    return this.view(vault.state(), vault.state().proposals[session]);
  }

  listProposals(filter: "pending" | "all" = "pending"): ProposalView[] {
    const state = this.deps.vault.state();
    return Object.values(state.proposals)
      .map((p) => this.view(state, p))
      .filter((p) => p.items.length > 0 && (filter === "all" || p.pending > 0))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  proposal(session: string): ProposalView {
    const state = this.deps.vault.state();
    return this.view(state, requireFound(state.proposals[session], `Proposal ${session}`));
  }

  /** Everything waiting for review, with the reasons it was surfaced. */
  pendingChanges(): PendingChanges {
    const state = this.deps.vault.state();
    const items = this.listProposals().flatMap((p) => p.items.filter((i) => i.decision === "pending"));
    const reasons = new Map(items.map((i) => [i.event.id, i.reasons]));
    const assertions = pendingAssertions(state).map((a) => ({ ...a, reasons: reasons.get(a.eventId) ?? [] }));
    const shown = new Set(assertions.map((a) => a.eventId));
    return { assertions, other: items.filter((i) => !shown.has(i.event.id)) };
  }

  /** Approve by Node, Edge or Event id: merges what is pending and marks it accepted. */
  approve(ids: string[], actor: ActorId = USER): ReviewOutcome {
    return approve(this.deps.vault, ids, actor);
  }

  /** Decline by Node, Edge or Event id: rejects what is pending, retires merged hypotheses. */
  decline(ids: string[], actor: ActorId = USER): ReviewOutcome {
    return decline(this.deps.vault, this.deps.review, ids, actor);
  }

  job(id: string): Job | undefined {
    return this.deps.queue.get(id);
  }

  // ---- internals ---------------------------------------------------------------------

  private interpretInput(entry: string): InterpretInput {
    const state = this.deps.vault.state();
    const record = state.entries[entry];
    if (!record) throw new NotFoundError(`Entry ${entry} not found`);
    return {
      entry: { id: entry, text: this.deps.vault.readText(entry), title: record.title },
      schema: this.deps.schemas.require(),
      context: contextNodes(state),
    };
  }

  private enqueueInterpretation(session: string, entry: string): Job {
    const actor = `model:${this.deps.interpretation.modelName}`;
    return this.deps.queue.enqueue(session, "interpret", async () => {
      try {
        const result = await this.deps.interpretation.interpret(this.interpretInput(entry));
        this.deps.vault.append(graphDrafts(result, actor, session));
      } finally {
        this.close(session, actor);
        this.autoReview(session);
      }
    });
  }

  private enqueueRevision(session: string, previous: string, entry: string, cited: CitedItem[]): Job {
    const actor = `model:${this.deps.interpretation.modelName}`;
    return this.deps.queue.enqueue(session, "revise", async () => {
      try {
        const input = { ...this.interpretInput(entry), oldText: this.deps.vault.readText(previous), cited };
        const revision = await this.deps.interpretation.revise(input);
        this.deps.vault.append(revisionDrafts(revision, actor, session));
      } finally {
        this.close(session, actor);
        this.autoReview(session);
      }
    });
  }

  private close(session: string, actor: ActorId): undefined {
    this.deps.vault.append([{ actor, session, type: "SessionClosed", body: {} }]);
    return undefined;
  }

  private autoReview(session: string): string[] {
    const { vault, review, schemas } = this.deps;
    const state = vault.state();
    const pending = pendingEvents(state.proposals[session]);
    const { autoAccept } = review.triage(pending, state.graph, schemas.current(), this.policy);
    if (autoAccept.length === 0) return [];
    vault.append([
      { actor: REVIEW_POLICY_ACTOR, session: newId(), type: "ProposalReviewed", body: { session, accepted: autoAccept, rejected: [] } },
    ]);
    return autoAccept;
  }

  private amendment(pending: AnyEvent[], amend: NonNullable<ReviewDecision["amend"]>[number], actor: ActorId): AnyDraft {
    const event = pending.find((e) => e.id === amend.eventId) as AnyEvent;
    const target = "id" in event.body ? (event.body.id as string) : amend.eventId;
    const body = { target, patch: amend.patch ?? {}, label: amend.label, confidence: amend.confidence };
    return { actor, session: event.session, type: "AttributesChanged", body };
  }

  private view(state: ProjectionState, proposal: Proposal): ProposalView {
    const pending = pendingEvents(proposal);
    const triage = this.deps.review.triage(pending, state.graph, state.schema, this.policy);
    const reasons = new Map(triage.review.map((r) => [r.eventId, r.reasons]));
    const { events, ...rest } = proposal;
    return {
      ...rest,
      entryTitle: proposal.entry ? state.entries[proposal.entry]?.title : undefined,
      pending: pending.length,
      items: events.filter((i) => i.event.actor !== USER).map((i) => ({ ...i, reasons: reasons.get(i.event.id) ?? [] })),
    };
  }
}
