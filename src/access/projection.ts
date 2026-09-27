// The Graph Projection: a pure fold over the Log. Graph at T = fold(Log[<= T]).
import {
  type ActorId,
  type AnyEvent,
  type Attributes,
  type EventBodies,
  type Evidence,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type ProjectionState,
  type SpanMove,
  type Status,
  type VaultEvent,
  GRAPH_EVENT_TYPES,
  USER,
} from "../core/types.js";

export function emptyState(): ProjectionState {
  return { graph: { nodes: {}, edges: {} }, schema: null, entries: {}, position: "" };
}

export function fold(events: readonly AnyEvent[], upTo?: string): ProjectionState {
  const state = emptyState();
  for (const event of events) {
    if (upTo !== undefined && event.hlc > upTo) break;
    applyEvent(state, event);
  }
  return state;
}

export function applyEvent(state: ProjectionState, event: AnyEvent): void {
  state.position = event.hlc;
  if (GRAPH_EVENT_TYPES.includes(event.type)) {
    applyGraphEvent(state.graph, event);
    return;
  }
  workflowHandlers[event.type]?.(state, event as never);
}

// ---- workflow events -------------------------------------------------------------

type Handler<K extends keyof EventBodies> = (state: ProjectionState, event: VaultEvent<K>) => void;
type HandlerTable = { [K in keyof EventBodies]?: Handler<K> };

const workflowHandlers: HandlerTable = {
  EntryAdded: (state, e) => {
    state.entries[e.body.entry] = {
      id: e.body.entry,
      source: e.body.source,
      title: e.body.title,
      bytes: e.body.bytes,
      addedAt: e.hlc,
      session: e.session,
      revises: e.body.revises,
    };
    if (e.body.revises) reviseEntry(state, e.body.revises, e.body.entry, e.body.remap ?? []);
  },
  SchemaChanged: (state, e) => {
    migrateGraph(state.graph, e.body.migration.nodeTypes, e.body.migration.edgeTypes);
    state.schema = e.body.schema;
  },
};

/** Moves Evidence from a revised Entry to the same text in its revision; unmatched spans stay put. */
function reviseEntry(state: ProjectionState, previous: string, next: string, remap: SpanMove[]): void {
  const old = state.entries[previous];
  if (old) old.revisedBy = next;
  const moves = new Map(remap.map((m) => [`${m.from.start}:${m.from.end}`, m.to]));
  const move = (e: Evidence): Evidence => {
    const to = e.entry === previous ? moves.get(`${e.start}:${e.end}`) : undefined;
    return to ? { entry: next, ...to } : e;
  };
  for (const item of [...Object.values(state.graph.nodes), ...Object.values(state.graph.edges)]) {
    item.evidence = item.evidence.map(move);
  }
}

function migrateGraph(graph: Graph, nodeMap: Record<string, string>, edgeMap: Record<string, string>): void {
  for (const node of Object.values(graph.nodes)) node.type = nodeMap[node.type] ?? node.type;
  for (const edge of Object.values(graph.edges)) edge.type = edgeMap[edge.type] ?? edge.type;
}

// ---- graph events ----------------------------------------------------------------

function statusFor(actor: ActorId): Status {
  return actor === USER ? "accepted" : "hypothesis";
}

export function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const seen = new Set(a.map(evidenceKey));
  return [...a, ...b.filter((e) => !seen.has(evidenceKey(e)))];
}

function evidenceKey(e: Evidence): string {
  return `${e.entry}:${e.start}:${e.end}`;
}

type GraphHandlers = { [K in keyof EventBodies]?: (graph: Graph, event: VaultEvent<K>) => void };

const graphHandlers: GraphHandlers = {
  NodeAsserted: assertNode,
  EdgeAsserted: assertEdge,
  AttributesChanged: changeAttributes,
  StatusChanged: (graph, e) => {
    const target = graph.nodes[e.body.target] ?? graph.edges[e.body.target];
    if (target) touch(target, e).status = e.body.status;
  },
  NodesSplit: splitNode,
  NodesMerged: mergeNodes,
};

function applyGraphEvent(graph: Graph, event: AnyEvent): void {
  graphHandlers[event.type]?.(graph, event as never);
}

function touch<T extends { updatedAt: string }>(item: T, event: AnyEvent): T {
  item.updatedAt = event.hlc;
  return item;
}

function assertNode(graph: Graph, e: VaultEvent<"NodeAsserted">): void {
  const existing = graph.nodes[e.body.id];
  if (existing) {
    reassert(existing, e.body, e);
    return;
  }
  const { similarTo: _hint, ...body } = e.body;
  graph.nodes[e.body.id] = {
    ...body,
    status: statusFor(e.actor),
    derivedFrom: [],
    assertedBy: e.actor,
    assertedAt: e.hlc,
    updatedAt: e.hlc,
  };
}

function reassert(
  item: GraphNode | GraphEdge,
  body: { type: string; attributes: Attributes; confidence: number; evidence: Evidence[] },
  e: AnyEvent,
): void {
  if (item.type !== body.type) return;
  item.attributes = { ...item.attributes, ...body.attributes };
  item.confidence = body.confidence;
  item.evidence = mergeEvidence(item.evidence, body.evidence);
  touch(item, e);
}

function assertEdge(graph: Graph, e: VaultEvent<"EdgeAsserted">): void {
  const existing = graph.edges[e.body.id];
  if (existing) {
    reassert(existing, e.body, e);
    return;
  }
  if (!graph.nodes[e.body.from] || !graph.nodes[e.body.to]) return;
  graph.edges[e.body.id] = {
    ...e.body,
    status: statusFor(e.actor),
    assertedBy: e.actor,
    assertedAt: e.hlc,
    updatedAt: e.hlc,
  };
}

function changeAttributes(graph: Graph, e: VaultEvent<"AttributesChanged">): void {
  const target = graph.nodes[e.body.target] ?? graph.edges[e.body.target];
  if (!target) return;
  target.attributes = patchAttributes(target.attributes, e.body.patch);
  if ("label" in target && e.body.label) target.label = e.body.label;
  if (e.body.confidence !== undefined) target.confidence = e.body.confidence;
  touch(target, e);
}

/** Last-writer-wins per field; a null value removes the field. */
export function patchAttributes(base: Attributes, patch: Attributes): Attributes {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

function reattach(edge: GraphEdge | undefined, from: string, to: string): void {
  if (!edge) return;
  if (edge.from === from) edge.from = to;
  if (edge.to === from) edge.to = to;
}

function splitNode(graph: Graph, e: VaultEvent<"NodesSplit">): void {
  const source = graph.nodes[e.body.source];
  if (!source) return;
  for (const part of e.body.into) {
    graph.nodes[part.id] = {
      ...source,
      id: part.id,
      label: part.label,
      type: part.type ?? source.type,
      attributes: { ...source.attributes, ...part.attributes },
      status: statusFor(e.actor),
      evidence: part.evidence,
      derivedFrom: [source.id],
      assertedBy: e.actor,
      assertedAt: e.hlc,
      updatedAt: e.hlc,
    };
    for (const edgeId of part.edges) reattach(graph.edges[edgeId], source.id, part.id);
  }
  touch(source, e).status = "superseded";
}

function mergeNodes(graph: Graph, e: VaultEvent<"NodesMerged">): void {
  const sources = e.body.sources.map((id) => graph.nodes[id]).filter(Boolean);
  if (sources.length === 0) return;
  graph.nodes[e.body.into.id] = {
    ...e.body.into,
    confidence: Math.max(...sources.map((s) => s.confidence)),
    status: statusFor(e.actor),
    evidence: sources.reduce<Evidence[]>((acc, s) => mergeEvidence(acc, s.evidence), []),
    derivedFrom: sources.map((s) => s.id),
    assertedBy: e.actor,
    assertedAt: e.hlc,
    updatedAt: e.hlc,
  };
  for (const source of sources) {
    touch(source, e).status = "superseded";
    for (const edge of Object.values(graph.edges)) reattach(edge, source.id, e.body.into.id);
  }
}
