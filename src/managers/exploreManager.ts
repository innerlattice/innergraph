// ExploreManager: queries and Projections (root tracing, loops, recall, evidence search).
import { rolesOf } from "../access/schemaAccess.js";
import type { VaultAccess } from "../access/vaultAccess.js";
import type { AnyEvent, EntryRecord, Evidence, Graph, GraphEdge, GraphNode, ProjectionState, Schema } from "../core/types.js";
import { type AnalysisEngine, type Loop, type LoopDetail, type LoopStep, type RootTrace, activeGraph } from "../engines/analysisEngine.js";
import type { RecallEngine } from "../engines/recallEngine.js";
import { byteOffset } from "../utilities/crypto.js";
import { type RelatedItem, buildCorpus, describeMatches } from "./recallCorpus.js";
import { pendingAssertions } from "./pending.js";
import { requireFound } from "./sessions.js";

export interface ExploreDeps {
  vault: VaultAccess;
  analysis: AnalysisEngine;
  recall: RecallEngine;
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
  node: GraphNode;
  evidence: EvidenceView[];
  outgoing: GraphEdge[];
  incoming: GraphEdge[];
  derivedFrom: GraphNode[];
  derivedInto: GraphNode[];
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
    item.evidence.map((evidence) => ({ target: item.id, label: "label" in item ? item.label : item.type, evidence })),
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
}

export interface Selection {
  ids: string[];
  at: string;
  items: SelectionItem[];
}

function describeItem(state: ProjectionState, id: string): SelectionItem | undefined {
  const proposed = pendingAssertions(state).find((a) => a.item.id === id);
  const graph: Graph = proposed ? withProposed(state.graph, proposed.item) : state.graph;
  const item = describeInGraph(graph, id);
  return item && proposed ? { ...item, status: "proposed" } : item;
}

function withProposed(graph: Graph, item: GraphNode | GraphEdge): Graph {
  return "from" in item ? { ...graph, edges: { ...graph.edges, [item.id]: item } } : { ...graph, nodes: { ...graph.nodes, [item.id]: item } };
}

function describeInGraph(graph: Graph, id: string): SelectionItem | undefined {
  const node = graph.nodes[id];
  if (node) return { id, kind: "node", type: node.type, label: node.label, status: node.status };
  const edge = graph.edges[id];
  if (!edge) return undefined;
  const label = `${graph.nodes[edge.from]?.label ?? edge.from} —${edge.type}→ ${graph.nodes[edge.to]?.label ?? edge.to}`;
  return { id, kind: "edge", type: edge.type, label, status: edge.status };
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

export class ExploreManager {
  constructor(private readonly deps: ExploreDeps) {}

  schema(): Schema | null {
    return this.deps.vault.state().schema;
  }

  graph(options: { includeSuperseded?: boolean } = {}): Graph {
    const graph = this.deps.vault.state().graph;
    return options.includeSuperseded ? graph : activeGraph(graph);
  }

  node(id: string): NodeView {
    const graph = this.deps.vault.state().graph;
    const node = requireFound(graph.nodes[id], `Node ${id}`);
    const edges = Object.values(graph.edges);
    return {
      node,
      evidence: node.evidence.map((e) => this.evidenceView(e)),
      outgoing: edges.filter((e) => e.from === id),
      incoming: edges.filter((e) => e.to === id),
      derivedFrom: node.derivedFrom.map((p) => graph.nodes[p]).filter(Boolean),
      derivedInto: Object.values(graph.nodes).filter((n) => n.derivedFrom.includes(id)),
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

  /** Offered, never pushed: returns related material only when asked. Parked Nodes never appear. */
  findRelated(query: { text?: string; nodeId?: string }): RelatedItem[] {
    const { vault, recall } = this.deps;
    const state = vault.state();
    const node = query.nodeId ? requireFound(state.graph.nodes[query.nodeId], `Node ${query.nodeId}`) : undefined;
    const text = node ? [node.label, ...node.evidence.map((e) => vault.readSpan(e))].join("\n") : (query.text ?? "");
    const exclude = node ? [node.id, ...node.evidence.map((e) => e.entry)] : [];
    return describeMatches(vault, state, recall.recall(text, buildCorpus(vault, state), { exclude }));
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
    const state = this.deps.vault.state();
    const items = stored.ids.map((id) => describeItem(state, id)).filter((i): i is SelectionItem => i !== undefined);
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
