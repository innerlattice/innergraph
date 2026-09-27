// ExploreManager: queries and Projections (root tracing, loops, recall, evidence search).
import { edgeText } from "../core/edgeText.js";
import { rolesOf } from "../access/schemaAccess.js";
import type { VaultAccess } from "../access/vaultAccess.js";
import type { AnyEvent, EntryRecord, Evidence, Graph, GraphEdge, GraphNode, ProjectionState, Schema } from "../core/types.js";
import { type AnalysisEngine, type Loop, type LoopDetail, type LoopStep, type RootTrace, activeGraph } from "../engines/analysisEngine.js";
import type { RecallEngine, Reranker, SearchHit } from "../engines/recallEngine.js";
import { toPosition } from "../utilities/hlc.js";
import { ACTIVE, type GraphView, VIEW_STATUSES, type ViewEdge, type ViewNode, type ViewStatus, materialize, normaliseEvidence } from "../access/view.js";
import type { Embedder } from "../utilities/modelGateway.js";
import { cachedVectors, graphDocs } from "./graphSearch.js";
import { byteOffset } from "../utilities/crypto.js";
import { type RelatedItem, buildCorpus, describeMatches } from "./recallCorpus.js";
import { type SessionChanges, changeFeed } from "./changeFeed.js";
import { requireFound } from "./sessions.js";

export interface ExploreDeps {
  vault: VaultAccess;
  analysis: AnalysisEngine;
  recall: RecallEngine;
  /** Optional dense retrieval; search falls back to lexical when absent or unavailable. */
  embedder?: Embedder;
  /** Optional reranking of the fused candidates. */
  reranker?: Reranker;
}

export interface ViewOptions {
  /** Which statuses to materialize (default: active). */
  statuses?: readonly ViewStatus[];
  /** Shorthand: also materialize removed items. */
  removed?: boolean;
  /** A past position (ISO date or HLC). */
  at?: string;
}

interface GraphSearchHit extends SearchHit {
  label: string;
  type: string;
  status: string;
  evidence?: string;
}

export interface GraphSearchResult {
  hits: GraphSearchHit[];
  /** Which stages ran: lexical always, dense and rerank when available. */
  stages: string[];
  notes: string[];
}

export interface EvidenceView extends Evidence {
  text: string;
  entryTitle: string;
  /** Surrounding text, trimmed to word boundaries, so a quote can be read in context. */
  before: string;
  after: string;
}

const CONTEXT_BYTES = 160;

/** Text around a byte span, cut back to whole words at the outer edges. */
export function spanContext(bytes: Buffer, start: number, end: number): { before: string; after: string } {
  const before = bytes.subarray(Math.max(0, start - CONTEXT_BYTES), start).toString("utf8");
  const after = bytes.subarray(end, end + CONTEXT_BYTES).toString("utf8");
  const trimmedBefore = start > CONTEXT_BYTES ? before.replace(/^\S*\s/, "") : before;
  const trimmedAfter = end + CONTEXT_BYTES < bytes.length ? after.replace(/\s\S*$/, "") : after;
  return { before: trimmedBefore.replace(/^\uFFFD+/, ""), after: trimmedAfter.replace(/\uFFFD+$/, "") };
}

export interface NodeView {
  node: ViewNode;
  evidence: EvidenceView[];
  outgoing: ViewEdge[];
  incoming: ViewEdge[];
  derivedFrom: GraphNode[];
  derivedInto: GraphNode[];
}

export interface EdgeView {
  edge: ViewEdge;
  fromLabel: string;
  toLabel: string;
  evidence: EvidenceView[];
}

export interface EvidenceHit extends Evidence {
  entryTitle: string;
  text: string;
  citedBy: string[];
}

export interface EntryView {
  entry: EntryRecord;
  text: string;
  citations: { target: string; label: string; evidence: Evidence }[];
}

function overlaps(a: Evidence, b: Evidence): boolean {
  return a.entry === b.entry && a.start < b.end && b.start < a.end;
}

function citationsOf(graph: Graph) {
  return [...Object.values(graph.nodes), ...Object.values(graph.edges)].flatMap((item) =>
    item.evidence.map((evidence) => ({ target: item.id, label: "label" in item ? item.label : edgeLabel(graph, item), evidence })),
  );
}

function findAll(text: string, query: string): number[] {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const hits: number[] = [];
  for (let i = lower.indexOf(needle); i >= 0 && needle; i = lower.indexOf(needle, i + needle.length)) hits.push(i);
  return hits;
}

export interface SelectionItem {
  id: string;
  kind: "node" | "edge";
  type: string;
  label: string;
  status: string;
  confirmed: boolean;
}

export interface Selection {
  ids: string[];
  at: string;
  items: SelectionItem[];
}

function edgeLabel(view: { nodes: Record<string, { label: string }> }, edge: { from: string; to: string; type: string }): string {
  return edgeText(view.nodes[edge.from]?.label ?? edge.from, edge.type, view.nodes[edge.to]?.label ?? edge.to);
}

function describeItem(view: GraphView, id: string): SelectionItem | undefined {
  const node = view.nodes[id];
  if (node) return { id, kind: "node", type: node.type, label: node.label, status: node.status, confirmed: node.confirmed };
  const edge = view.edges[id];
  return edge ? { id, kind: "edge", type: edge.type, label: edgeLabel(view, edge), status: edge.status, confirmed: edge.confirmed } : undefined;
}

export interface LoopStepView extends LoopStep {
  fromLabel: string;
  toLabel: string;
  quotes: string[];
}

export interface LoopView extends Omit<LoopDetail, "steps" | "inputs" | "outputs" | "weakest"> {
  steps: LoopStepView[];
  inputs: LoopStepView[];
  outputs: LoopStepView[];
  weakest: LoopStepView;
}

function describeHit(vault: VaultAccess, view: GraphView, hit: SearchHit): GraphSearchHit {
  const item = describeItem(view, hit.id) as SelectionItem;
  const first = (view.nodes[hit.id] ?? view.edges[hit.id])?.evidence[0];
  return { ...hit, label: item.label, type: item.type, status: item.status, evidence: first ? vault.readSpan(first) : undefined };
}

/** Nodes merged or split away are history, not part of the View; lineage links still open them. */
function replacedNode(state: ProjectionState, id: string): ViewNode | undefined {
  const node = state.graph.nodes[id];
  if (!node) return undefined;
  const { evidence, stale } = normaliseEvidence(node.evidence, state);
  const { status: _s, ...rest } = node;
  return { ...rest, evidence, status: "removed", confirmed: false, staleEvidence: stale };
}

function filterFor(options: ViewOptions): readonly ViewStatus[] {
  if (options.statuses && options.statuses.length > 0) return options.statuses;
  return options.removed ? VIEW_STATUSES : ACTIVE;
}

export class ExploreManager {
  constructor(private readonly deps: ExploreDeps) {}

  schema(): Schema | null {
    return this.deps.vault.state().schema;
  }

  graph(options: { includeSuperseded?: boolean } = {}): Graph {
    const graph = this.deps.vault.state().graph;
    return options.includeSuperseded ? graph : activeGraph(graph);
  }

  /** The materialized View the graph display renders: one status per item, filtered. */
  view(options: ViewOptions = {}): GraphView {
    const state = options.at ? this.deps.vault.stateAt(toPosition(options.at)) : this.deps.vault.state();
    return materialize(state, filterFor(options));
  }

  /** What changed, grouped by Session, newest first; each Session can be undone as a whole. */
  changes(limit = 30): SessionChanges[] {
    const { vault } = this.deps;
    return changeFeed(vault.events(), vault.state(), limit);
  }

  /** A Node from the View (whatever its status), with Edges filtered like the View. */
  node(id: string, options: ViewOptions = {}): NodeView {
    const state = this.deps.vault.state();
    const node = requireFound(materialize(state, VIEW_STATUSES).nodes[id] ?? replacedNode(state, id), `Node ${id}`);
    const shown = materialize(state, filterFor(options));
    const edges = Object.values(shown.edges);
    return {
      node,
      evidence: node.evidence.map((e) => this.evidenceView(e)),
      outgoing: edges.filter((e) => e.from === id),
      incoming: edges.filter((e) => e.to === id),
      derivedFrom: node.derivedFrom.map((p) => state.graph.nodes[p]).filter(Boolean),
      derivedInto: Object.values(state.graph.nodes).filter((n) => n.derivedFrom.includes(id)),
    };
  }

  edge(id: string): EdgeView {
    const state = this.deps.vault.state();
    const all = materialize(state, VIEW_STATUSES);
    const edge = requireFound(all.edges[id], `Edge ${id}`);
    return {
      edge,
      fromLabel: all.nodes[edge.from]?.label ?? edge.from,
      toLabel: all.nodes[edge.to]?.label ?? edge.to,
      evidence: edge.evidence.map((e) => this.evidenceView(e)),
    };
  }

  traceRoots(id: string): RootTrace {
    const state = this.deps.vault.state();
    requireFound(state.graph.nodes[id], `Node ${id}`);
    return this.deps.analysis.traceRoots(state.graph, rolesOf(state.schema), id);
  }

  findLoops(): Loop[] {
    const state = this.deps.vault.state();
    return this.deps.analysis.findLoops(state.graph, rolesOf(state.schema));
  }

  /** Loops with their structure and the quoted evidence for each step. */
  loopDetails(): LoopView[] {
    const state = this.deps.vault.state();
    const { nodes, edges } = state.graph;
    const withText = (s: LoopStep): LoopStepView => ({
      ...s,
      fromLabel: nodes[s.from]?.label ?? s.from,
      toLabel: nodes[s.to]?.label ?? s.to,
      quotes: (edges[s.edge]?.evidence ?? []).map((e) => this.deps.vault.readSpan(e)),
    });
    return this.deps.analysis.loopDetails(state.graph, rolesOf(state.schema)).map((d) => ({
      ...d,
      steps: d.steps.map(withText),
      inputs: d.inputs.map(withText),
      outputs: d.outputs.map(withText),
      weakest: withText(d.weakest),
    }));
  }

  groups(): string[][] {
    const state = this.deps.vault.state();
    return this.deps.analysis.groups(state.graph, rolesOf(state.schema));
  }

  /** Offered, never pushed: returns related material only when asked. Removed Nodes never appear. */
  findRelated(query: { text?: string; nodeId?: string }): RelatedItem[] {
    const { vault, recall } = this.deps;
    const state = vault.state();
    const node = query.nodeId ? requireFound(state.graph.nodes[query.nodeId], `Node ${query.nodeId}`) : undefined;
    const text = node ? [node.label, ...node.evidence.map((e) => vault.readSpan(e))].join("\n") : (query.text ?? "");
    const exclude = node ? [node.id, ...node.evidence.map((e) => e.entry)] : [];
    return describeMatches(vault, state, recall.recall(text, buildCorpus(vault, state), { exclude }));
  }

  /** Hybrid search over Nodes and Edges: lexical + dense, fused, then reranked. Removed items never appear. */
  async searchGraph(query: string, limit = 10): Promise<GraphSearchResult> {
    const { vault, recall, embedder, reranker } = this.deps;
    const state = vault.state();
    const docs = graphDocs(vault, state);
    const notes: string[] = [];
    const vectors = embedder ? await this.vectors(embedder, query, docs, notes) : undefined;
    const hits = await recall.search({ query, docs, ...vectors }, reranker, limit).catch((error: Error) => {
      notes.push(`rerank skipped: ${error.message}`);
      return recall.search({ query, docs, ...vectors }, undefined, limit);
    });
    const stages = ["lexical", ...(vectors ? ["dense"] : []), ...(hits.some((h) => h.stages.rerank !== undefined) ? ["rerank"] : [])];
    return { hits: hits.map((h) => describeHit(vault, materialize(state), h)), stages, notes };
  }

  private async vectors(embedder: Embedder, query: string, docs: { text: string }[], notes: string[]) {
    try {
      const docVectors = await cachedVectors(this.deps.vault, embedder, docs.map((d) => d.text));
      const queryVector = embedder.embedQuery ? await embedder.embedQuery(query) : (await embedder.embed([query]))[0];
      return { queryVector, docVectors };
    } catch (error) {
      notes.push(`dense retrieval skipped: ${(error as Error).message}`);
      return undefined;
    }
  }

  searchEvidence(query: string, limit = 50): EvidenceHit[] {
    const state = this.deps.vault.state();
    const citations = citationsOf(state.graph);
    return Object.values(state.entries)
      .flatMap((entry) => this.hitsIn(entry, query, citations))
      .slice(0, limit);
  }

  /** Latest version of each Entry, newest first. */
  entries(): EntryRecord[] {
    return Object.values(this.deps.vault.state().entries)
      .filter((e) => !e.revisedBy)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  entry(id: string): EntryView {
    const state = this.deps.vault.state();
    const entry = requireFound(state.entries[id], `Entry ${id}`);
    const citations = citationsOf(state.graph).filter((c) => c.evidence.entry === id);
    return { entry, text: this.deps.vault.readText(id), citations };
  }

  /** What the user currently has selected in the graph view. */
  selection(): Selection {
    const stored = this.deps.vault.readSetting<{ ids: string[]; at: string }>("selection") ?? { ids: [], at: "" };
    const view = materialize(this.deps.vault.state(), VIEW_STATUSES);
    const items = stored.ids.map((id) => describeItem(view, id)).filter((i): i is SelectionItem => i !== undefined);
    return { ...stored, items };
  }

  setSelection(ids: string[]): Selection {
    this.deps.vault.writeSetting("selection", { ids: [...new Set(ids)], at: new Date().toISOString() });
    return this.selection();
  }

  /** HLC of the latest Event; changes whenever anything (in any process) appends. */
  position(): string {
    return this.deps.vault.state().position;
  }

  timeline(limit = 200): AnyEvent[] {
    return this.deps.vault.events().slice(-limit).reverse();
  }

  private evidenceView(e: Evidence): EvidenceView {
    const title = this.deps.vault.state().entries[e.entry]?.title ?? e.entry;
    const bytes = this.deps.vault.readBlob(e.entry) ?? Buffer.alloc(0);
    return { ...e, text: this.deps.vault.readSpan(e), entryTitle: title, ...spanContext(bytes, e.start, e.end) };
  }

  private hitsIn(entry: EntryRecord, query: string, citations: ReturnType<typeof citationsOf>): EvidenceHit[] {
    const text = this.deps.vault.readText(entry.id);
    return findAll(text, query).map((index) => {
      const span = { entry: entry.id, start: byteOffset(text, index), end: byteOffset(text, index + query.length) };
      const context = text.slice(Math.max(0, index - 80), index + query.length + 80);
      const citedBy = citations.filter((c) => overlaps(c.evidence, span)).map((c) => c.target);
      return { ...span, entryTitle: entry.title, text: context, citedBy };
    });
  }
}
