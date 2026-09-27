// MapManager: Refactors, Schema migrations, Status changes and time travel.
import { SchemaError } from "../access/schemaAccess.js";
import type { SchemaAccess } from "../access/schemaAccess.js";
import type { VaultAccess } from "../access/vaultAccess.js";
import {
  type ActorId,
  type Attributes,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type MigrationMap,
  type Schema,
  type SplitPart,
  GRAPH_EVENT_TYPES,
  USER,
} from "../core/types.js";
import type { AnalysisEngine, GraphDiff } from "../engines/analysisEngine.js";
import type { InterpretationEngine } from "../engines/interpretationEngine.js";
import { newId } from "../utilities/crypto.js";
import { toPosition } from "../utilities/hlc.js";
import { mergeEvidence } from "../access/projection.js";
import { type DuplicateGroup, findDuplicates } from "./resolve.js";
import { type RevertPlan, planRevert, targetsOf, withActor } from "./revert.js";
import { ForbiddenError, requireFound, runSession } from "./sessions.js";

export interface MapDeps {
  vault: VaultAccess;
  schemas: SchemaAccess;
  interpretation: InterpretationEngine;
  analysis: AnalysisEngine;
}

/** Every change lands at once as one Session; undo it with `undoSession`. */
export interface ChangeResult {
  session: string;
}

export interface GraphAt {
  position: string;
  graph: Graph;
}

/** Accepts an HLC string or anything Date.parse understands. */
export interface UndoResult {
  session: string;
  summary: RevertPlan["summary"];
}

/** Undoing a Node change also covers the Edges attached to it, before or after. */
function withAttachedEdges(ids: Set<string>, graphs: Graph[]): Set<string> {
  const edges = graphs.flatMap((g) => Object.values(g.edges)).filter((e) => ids.has(e.from) || ids.has(e.to));
  return new Set([...ids, ...edges.map((e) => e.id)]);
}

function describeEdge(edge: GraphEdge, graph: Graph): string {
  const from = graph.nodes[edge.from]?.label ?? edge.from;
  const to = graph.nodes[edge.to]?.label ?? edge.to;
  return `${from} -[${edge.type}]-> ${to}`;
}

function checkMigration(schema: Schema, migration: MigrationMap): void {
  const badNodes = Object.values(migration.nodeTypes).filter((t) => !schema.nodeTypes[t]);
  const badEdges = Object.values(migration.edgeTypes).filter((t) => !schema.edgeTypes[t]);
  const bad = [...badNodes, ...badEdges];
  if (bad.length > 0) throw new SchemaError(`Migration targets types missing from the new Schema: ${bad.join(", ")}`);
}

export class MapManager {
  constructor(private readonly deps: MapDeps) {}

  /** Takes Nodes/Edges off the map; they stay in history and can be restored. */
  remove(ids: string[], actor: ActorId = USER, reason?: string): ChangeResult & { removed: string[] } {
    const removed = [...new Set(ids)].filter((id) => this.item(id).status !== "superseded");
    const drafts = removed.map((target) => ({ type: "StatusChanged" as const, body: { target, status: "superseded" as const, reason } }));
    return { ...this.commit(actor, "remove", drafts), removed };
  }

  /** Marks items as right. Only the person can confirm; agents' additions stay unconfirmed. */
  confirm(ids: string[], actor: ActorId = USER): ChangeResult & { confirmed: string[] } {
    if (actor !== USER) throw new ForbiddenError("Only the person can confirm items");
    const confirmed = [...new Set(ids)].filter((id) => this.item(id).status === "hypothesis");
    const drafts = confirmed.map((target) => ({ type: "StatusChanged" as const, body: { target, status: "accepted" as const } }));
    return { ...this.commit(actor, "confirm", drafts), confirmed };
  }

  changeAttributes(
    target: string,
    change: { patch?: Attributes; label?: string; confidence?: number },
    actor: ActorId = USER,
  ): ChangeResult {
    this.item(target);
    const body = { target, patch: change.patch ?? {}, label: change.label, confidence: change.confidence };
    return this.commit(actor, "edit", [{ type: "AttributesChanged", body }]);
  }

  async split(source: string, parts: { label: string; type?: string }[], actor: ActorId = USER): Promise<ChangeResult> {
    if (parts.length < 2) throw new Error("A split needs at least two parts");
    const graph = this.deps.vault.state().graph;
    const node = this.liveNode(source);
    const edges = Object.values(graph.edges).filter((e) => e.from === source || e.to === source);
    const assignment = await this.deps.interpretation.assignSplit({
      label: node.label,
      parts: parts.map((p) => p.label),
      evidence: node.evidence.map((e) => this.deps.vault.readSpan(e)),
      edges: edges.map((e) => describeEdge(e, graph)),
    });
    const into: SplitPart[] = parts.map((p, i) => ({
      id: newId(),
      label: p.label,
      type: p.type,
      evidence: assignment[i].evidence.map((k) => node.evidence[k]),
      edges: assignment[i].edges.map((k) => edges[k].id),
    }));
    return this.commit(actor, "refactor", [{ type: "NodesSplit", body: { source, into } }]);
  }

  merge(sources: string[], into: { label: string; type?: string }, actor: ActorId = USER): ChangeResult {
    if (sources.length < 2) throw new Error("A merge needs at least two Nodes");
    const nodes = sources.map((id) => this.liveNode(id));
    const attributes = Object.assign({}, ...nodes.map((n) => n.attributes)) as Attributes;
    const body = { sources, into: { id: newId(), label: into.label, type: into.type ?? nodes[0].type, attributes } };
    return this.commit(actor, "refactor", [{ type: "NodesMerged", body }]);
  }

  changeSchema(schema: Schema, migration: Partial<MigrationMap> = {}, actor: ActorId = USER): ChangeResult {
    if (actor !== USER) throw new ForbiddenError("Only the user may change the Schema");
    const current = this.deps.schemas.current();
    if (current && schema.version <= current.version) throw new SchemaError("Schema version must increase");
    const map = { nodeTypes: migration.nodeTypes ?? {}, edgeTypes: migration.edgeTypes ?? {} };
    checkMigration(schema, map);
    return this.commit(actor, "schema", [{ type: "SchemaChanged", body: { schema, migration: map } }]);
  }

  graphAt(at: string): GraphAt {
    const state = this.deps.vault.stateAt(toPosition(at));
    return { position: state.position, graph: state.graph };
  }

  diff(from: string, to: string): GraphDiff {
    return this.deps.analysis.diff(this.graphAt(from).graph, this.graphAt(to).graph);
  }

  /** Existing duplicate Nodes and Edges. */
  duplicates(): DuplicateGroup[] {
    return findDuplicates(this.deps.vault.state());
  }

  /**
   * Cleans up duplicates: Nodes are merged (lineage kept); for Edges the oldest is kept,
   * gains the others' evidence, and the rest are retired.
   */
  mergeDuplicates(actor: ActorId = USER, groups: DuplicateGroup[] = this.duplicates()): ChangeResult[] {
    const results: ChangeResult[] = [];
    for (const group of groups.filter((g) => g.kind === "node")) {
      const label = this.deps.vault.state().graph.nodes[group.ids[0]]?.label ?? "Merged";
      results.push(this.merge(group.ids, { label }, actor));
    }
    const edges = groups.filter((g) => g.kind === "edge");
    if (edges.length > 0) results.push(this.commit(actor, "deduplicate", edges.flatMap((g) => this.edgeCleanup(g))));
    return results;
  }

  private edgeCleanup(group: DuplicateGroup): { type: "EdgeAsserted" | "StatusChanged"; body: unknown }[] {
    const graph = this.deps.vault.state().graph;
    const [keep, ...extra] = group.ids.map((id) => graph.edges[id]);
    const { status: _s, assertedBy: _b, assertedAt: _a, updatedAt: _u, ...body } = keep;
    const evidence = extra.reduce((acc, e) => mergeEvidence(acc, e.evidence), keep.evidence);
    return [
      { type: "EdgeAsserted", body: { ...body, evidence } },
      ...extra.map((e) => ({ type: "StatusChanged" as const, body: { target: e.id, status: "superseded", reason: `duplicate of ${keep.id}` } })),
    ];
  }

  /** What reverting to a position would do, without doing it. */
  revertPreview(at: string): RevertPlan["summary"] {
    const position = toPosition(at);
    return planRevert(this.deps.vault.stateAt(position), this.deps.vault.state(), position).summary;
  }

  /** Returns the whole graph to how it was at `at`, with new compensating Events. */
  revert(at: string, actor: ActorId = USER): UndoResult {
    const position = toPosition(at);
    return this.applyPlan(planRevert(this.deps.vault.stateAt(position), this.deps.vault.state(), position), actor, "revert");
  }

  /** Undoes one Event: the items it touched return to how they were just before it. */
  undo(eventId: string, actor: ActorId = USER): UndoResult {
    const events = this.deps.vault.events();
    const index = events.findIndex((e) => e.id === eventId);
    const event = requireFound(events[index], `Event ${eventId}`);
    const state = this.deps.vault.state();
    const position = events[index - 1]?.hlc ?? "";
    const before = this.deps.vault.stateAt(position);
    const only = withAttachedEdges(new Set(targetsOf(event)), [before.graph, state.graph]);
    const plan = planRevert(before, state, event.hlc, only);
    return this.applyPlan(plan, actor, "undo");
  }

  /** Undoes everything one Session changed: its items return to how they were just before it. */
  undoSession(session: string, actor: ActorId = USER): UndoResult {
    const events = this.deps.vault.events();
    const first = events.findIndex((e) => e.session === session);
    requireFound(events[first], `Session ${session}`);
    const state = this.deps.vault.state();
    const before = this.deps.vault.stateAt(events[first - 1]?.hlc ?? "");
    const touched = events.filter((e) => e.session === session && GRAPH_EVENT_TYPES.includes(e.type)).flatMap((e) => targetsOf(e));
    const only = withAttachedEdges(new Set(touched), [before.graph, state.graph]);
    return this.applyPlan(planRevert(before, state, events[first].hlc, only), actor, "undo");
  }

  /** Brings back a removed Node/Edge. */
  restore(id: string, actor: ActorId = USER): UndoResult {
    const item = this.item(id);
    const retiring = this.deps.vault.events().filter((e) => e.type === "StatusChanged" && e.body.target === id && e.body.status === "superseded").at(-1);
    if (item.status !== "superseded" || !retiring) throw new Error(`${id} is not removed`);
    return this.undo(retiring.id, actor);
  }

  /** HLC positions of every Event, for time-travel sliders. */
  positions(): string[] {
    return this.deps.vault.events().map((e) => e.hlc);
  }

  private liveNode(id: string): GraphNode {
    const node = requireFound(this.deps.vault.state().graph.nodes[id], `Node ${id}`);
    if (node.status === "superseded") throw new Error(`Node ${id} is superseded; refactor its successors instead`);
    return node;
  }

  private item(target: string): GraphNode | GraphEdge {
    const graph = this.deps.vault.state().graph;
    return requireFound(graph.nodes[target] ?? graph.edges[target], `Node or Edge ${target}`);
  }

  /** Appends a revert plan as one Session. */
  private applyPlan(plan: RevertPlan, actor: ActorId, purpose: string): UndoResult {
    const drafts = plan.drafts.map((d) => ({ ...d, id: newId() }));
    const { session } = runSession(this.deps.vault, actor, purpose, (s) => withActor(drafts, actor, s));
    return { session, summary: plan.summary };
  }

  private commit(
    actor: ActorId,
    purpose: string,
    changes: { type: "StatusChanged" | "AttributesChanged" | "NodesSplit" | "NodesMerged" | "SchemaChanged" | "EdgeAsserted"; body: unknown }[],
  ): ChangeResult {
    const { session } = runSession(this.deps.vault, actor, purpose, (s) =>
      changes.map((c) => ({ actor, session: s, type: c.type, body: c.body }) as never),
    );
    return { session };
  }
}
