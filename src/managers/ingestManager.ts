// IngestManager: Entry in -> Session -> InterpretationEngine -> resolved against the graph -> written.
// Everything lands at once as one Session; the person undoes what they do not want.
import { type RawInput, normalise } from "../access/ingestAccess.js";
import type { SchemaAccess } from "../access/schemaAccess.js";
import type { VaultAccess } from "../access/vaultAccess.js";
import { type ActorId, type AnyDraft, type Evidence, type ProjectionState, USER } from "../core/types.js";
import type { CitedItem, ContextNode, InterpretInput, Interpretation, InterpretationEngine, Revision } from "../engines/interpretationEngine.js";
import type { Resolved } from "../engines/resolution.js";
import type { RecallEngine } from "../engines/recallEngine.js";
import { newId, utf8 } from "../utilities/crypto.js";
import type { Job, JobQueue } from "../utilities/jobQueue.js";
import { type RelatedItem, buildCorpus, describeMatches } from "./recallCorpus.js";
import { contextFor, resolveAgainst } from "./resolve.js";
import { citedItems, citedSpans, computeRemap } from "./revision.js";
import { NotFoundError, openSession, requireFound, runSession } from "./sessions.js";

export interface IngestDeps {
  vault: VaultAccess;
  schemas: SchemaAccess;
  interpretation: InterpretationEngine;
  recall: RecallEngine;
  queue: JobQueue;
}

export interface IngestResult {
  session: string;
  entry: string;
  related: RelatedItem[];
  job?: Job;
}

/** A Node or Edge a write touched, with the passages it cites (so a Client can highlight them). */
interface WrittenItem {
  id: string;
  kind: "node" | "edge";
  label: string;
  evidence: Evidence[];
  /** The cited text itself, in the same order as `evidence`. */
  quotes: string[];
}

export interface ProposeResult {
  session: string;
  items: WrittenItem[];
  dropped: string[];
  /** Proposed Nodes recognised as existing ones and re-asserted instead of duplicated. */
  merged?: Resolved["merged"];
}

export interface AmendResult {
  session: string;
  changed: string[];
  dropped: string[];
}

function written(result: Interpretation, quote: (e: Evidence) => string): WrittenItem[] {
  const item = (id: string, kind: "node" | "edge", label: string, evidence: Evidence[]) => ({ id, kind, label, evidence, quotes: evidence.map(quote) });
  return [...result.nodes.map((n) => item(n.id, "node", n.label, n.evidence)), ...result.edges.map((e) => item(e.id, "edge", e.type, e.evidence))];
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

/** A retraction of something the same revision re-asserts is a contradiction: keep the assertion. */
function revisionDrafts(revision: Revision, actor: ActorId, session: string, added: Interpretation = revision.added): AnyDraft[] {
  const reasserted = new Set([...added.nodes, ...added.edges].map((a) => a.id));
  const retractions = revision.retract
    .filter((id) => !reasserted.has(id))
    .map((target) => ({
      actor,
      session,
      type: "Marked" as const,
      body: { target, removed: true, reason: "no longer supported by the edited entry" },
    }));
  return [...revision.updates.map((u) => amendmentDraft(u, actor, session)), ...retractions, ...graphDrafts(revision.added, actor, session)];
}

function allLive(state: ProjectionState): ContextNode[] {
  return Object.values(state.graph.nodes)
    .filter((n) => !n.removed)
    .map(({ id, type, label }) => ({ id, type, label }));
}

export class IngestManager {
  constructor(private readonly deps: IngestDeps) {}

  addEntry(input: RawInput, options: { interpret?: boolean; actor?: ActorId } = {}): IngestResult {
    const { vault } = this.deps;
    const entry = normalise(input);
    const bytes = utf8(entry.text);
    const hash = vault.putBlob(bytes, entry.media);
    const session = newId();
    const actor = options.actor ?? USER;
    vault.append([
      openSession(actor, session, "ingest", hash),
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
      openSession(actor, session, "revise", hash),
      { actor, session, type: "EntryAdded", body: { entry: hash, source: next.source, title: next.title, bytes: bytes.length, revises: entry, remap } },
    ]);
    const job = options.interpret === false ? this.close(session, actor) : this.enqueueRevision(session, entry, hash, cited);
    return { session, entry: hash, previous: entry, remapped: remap.length, cited, job };
  }

  /** Label/attribute corrections by any Actor. */
  amend(actor: ActorId, changes: Amendment[]): AmendResult {
    const known = this.deps.vault.state().graph;
    const valid = changes.filter((c) => known.nodes[c.id] || known.edges[c.id]);
    const { session } = runSession(this.deps.vault, actor, "amend", (s) => valid.map((c) => amendmentDraft(c, actor, s)));
    const dropped = changes.filter((c) => !valid.includes(c)).map((c) => `${c.id}: not found`);
    return { session, changed: valid.map((c) => c.id), dropped };
  }

  related(text: string, exclude: string[] = []): RelatedItem[] {
    const state = this.deps.vault.state();
    const matches = this.deps.recall.recall(text, buildCorpus(this.deps.vault, state), { exclude });
    return describeMatches(this.deps.vault, state, matches);
  }

  /** An agent writes Nodes and Edges citing quotes from an existing Entry, resolved against the graph first. */
  propose(actor: ActorId, entry: string, raw: unknown): ProposeResult {
    const checked = this.deps.interpretation.check(raw, this.interpretInput(entry, "all"));
    const { result, merged } = resolveAgainst(this.deps.vault.state(), checked);
    const { session } = runSession(this.deps.vault, actor, "propose", (s) => graphDrafts(result, actor, s));
    return { session, items: written(result, (e) => this.deps.vault.readSpan(e)), dropped: result.dropped, merged };
  }

  job(id: string): Job | undefined {
    return this.deps.queue.get(id);
  }

  // ---- internals ---------------------------------------------------------------------

  /** "related" narrows existing Nodes to those relevant to the Entry (for prompts); "all" is for resolving ids. */
  private interpretInput(entry: string, scope: "related" | "all" = "related", cites?: string): InterpretInput {
    const { vault } = this.deps;
    const state = vault.state();
    const record = state.entries[entry];
    if (!record) throw new NotFoundError(`Entry ${entry} not found`);
    const text = vault.readText(entry);
    return {
      entry: { id: entry, text, title: record.title },
      schema: this.deps.schemas.require(),
      context: scope === "all" ? allLive(state) : contextFor(vault, state, text, cites ?? entry),
    };
  }

  /** Resolves against everything that exists at write time, not when the model started. */
  private appendResolved(result: Interpretation, actor: ActorId, session: string, extra: (resolved: Interpretation) => AnyDraft[] = () => []): void {
    const { result: resolved } = resolveAgainst(this.deps.vault.state(), result);
    this.deps.vault.append([...extra(resolved), ...graphDrafts(resolved, actor, session)]);
  }

  private enqueueInterpretation(session: string, entry: string): Job {
    const actor = `model:${this.deps.interpretation.modelName}`;
    return this.deps.queue.enqueue(session, "interpret", async () => {
      try {
        const result = await this.deps.interpretation.interpret(this.interpretInput(entry));
        this.appendResolved(result, actor, session);
      } finally {
        this.close(session, actor);
      }
    });
  }

  private enqueueRevision(session: string, previous: string, entry: string, cited: CitedItem[]): Job {
    const actor = `model:${this.deps.interpretation.modelName}`;
    return this.deps.queue.enqueue(session, "revise", async () => {
      try {
        const input = { ...this.interpretInput(entry, "related", previous), oldText: this.deps.vault.readText(previous), cited };
        const revision = await this.deps.interpretation.revise(input);
        this.appendResolved(revision.added, actor, session, (added) => revisionDrafts({ ...revision, added: { ...added, nodes: [], edges: [] } }, actor, session, added));
      } finally {
        this.close(session, actor);
      }
    });
  }

  private close(session: string, actor: ActorId): undefined {
    this.deps.vault.append([{ actor, session, type: "SessionClosed", body: {} }]);
    return undefined;
  }
}
