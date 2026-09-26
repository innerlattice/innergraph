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
  type Status,
  USER,
} from "../core/types.js";
import type { AnalysisEngine, GraphDiff } from "../engines/analysisEngine.js";
import type { InterpretationEngine } from "../engines/interpretationEngine.js";
import { newId } from "../utilities/crypto.js";
import { hlcAtTime } from "../utilities/hlc.js";
import { ForbiddenError, requireFound, runSession } from "./sessions.js";

export interface MapDeps {
  vault: VaultAccess;
  schemas: SchemaAccess;
  interpretation: InterpretationEngine;
  analysis: AnalysisEngine;
}

export interface ChangeResult {
  session: string;
  /** False when the change came from an agent and now awaits Review. */
  applied: boolean;
}

export interface GraphAt {
  position: string;
  graph: Graph;
}

/** Accepts an HLC string or anything Date.parse understands. */
export function toPosition(at: string): string {
  if (/^\d{15}\.\d{6}\./.test(at)) return at;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`Cannot read time position "${at}"`);
  return hlcAtTime(ms);
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

  setStatus(target: string, status: Status, actor: ActorId = USER, reason?: string): ChangeResult {
    const current = this.item(target);
    if (current.status === "parked" && status !== "parked" && actor !== USER) {
      throw new ForbiddenError("No agent may un-park a Node");
    }
    return this.commit(actor, "status", [{ type: "StatusChanged", body: { target, status, reason } }]);
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

  private commit(
    actor: ActorId,
    purpose: string,
    changes: { type: "StatusChanged" | "AttributesChanged" | "NodesSplit" | "NodesMerged" | "SchemaChanged"; body: unknown }[],
  ): ChangeResult {
    const { session } = runSession(this.deps.vault, actor, purpose, (s) =>
      changes.map((c) => ({ actor, session: s, type: c.type, body: c.body }) as never),
    );
    return { session, applied: actor === USER };
  }
}
