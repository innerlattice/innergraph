// AnalysisEngine: structural queries over a Graph, driven only by Roles.
import type { Graph, GraphEdge, GraphNode, Role } from "../core/types.js";
import { type Arc, components, elementaryCycles, reachable, shortestPath } from "../utilities/graphAlgo.js";

export type Roles = Record<string, Role | undefined>;

interface RootCandidate {
  id: string;
  /** Number of Nodes downstream of this root along derivational Edges. */
  support: number;
  path: string[];
}

export interface RootTrace {
  node: string;
  upstream: string[];
  roots: RootCandidate[];
}

export interface Loop {
  nodes: string[];
  edges: string[];
  polarity: "reinforcing" | "balancing";
}

export interface LoopStep {
  edge: string;
  from: string;
  to: string;
  sign: 1 | -1;
  confidence: number;
}

export interface LoopDetail extends Loop {
  steps: LoopStep[];
  /** Causal edges from outside the loop into it: negative ones act as brakes, positive as accelerators. */
  inputs: LoopStep[];
  /** Causal edges from the loop to things outside it: what the loop drives. */
  outputs: LoopStep[];
  /** The least certain step. */
  weakest: LoopStep;
  /** Product of step confidences: how sure the whole loop is, taken together. */
  certainty: number;
  /** Other loops sharing at least one node with this one. */
  linkedLoops: number;
}

interface ItemDiff<T> {
  added: T[];
  removed: T[];
  changed: { before: T; after: T }[];
}

export interface GraphDiff {
  nodes: ItemDiff<GraphNode>;
  edges: ItemDiff<GraphEdge>;
}

const isLive = (item: { status: string }) => item.status !== "superseded";

/** The Graph without superseded Nodes, and without Edges touching them. */
export function activeGraph(graph: Graph): Graph {
  const nodes = Object.fromEntries(Object.entries(graph.nodes).filter(([, n]) => isLive(n)));
  const edges = Object.fromEntries(
    Object.entries(graph.edges).filter(([, e]) => isLive(e) && nodes[e.from] && nodes[e.to]),
  );
  return { nodes, edges };
}

function arcs(graph: Graph, roles: Roles, role: Role): GraphEdge[] {
  return Object.values(activeGraph(graph).edges).filter((e) => roles[e.type] === role);
}

function signature(item: GraphNode | GraphEdge): string {
  const { updatedAt: _u, evidence, ...rest } = item;
  return JSON.stringify({ ...rest, evidence: evidence.length });
}

function diffRecords<T extends GraphNode | GraphEdge>(a: Record<string, T>, b: Record<string, T>): ItemDiff<T> {
  return {
    added: Object.values(b).filter((x) => !a[x.id]),
    removed: Object.values(a).filter((x) => !b[x.id]),
    changed: Object.values(b)
      .filter((x) => a[x.id] && signature(a[x.id]) !== signature(x))
      .map((after) => ({ before: a[after.id], after })),
  };
}

function toLoop(cycle: Arc[], edges: Record<string, GraphEdge>): Loop {
  const product = cycle.reduce((acc, arc) => acc * (edges[arc.id].sign ?? 1), 1);
  return {
    nodes: cycle.map((arc) => arc.from),
    edges: cycle.map((arc) => arc.id),
    polarity: product > 0 ? "reinforcing" : "balancing",
  };
}

function step(e: GraphEdge): LoopStep {
  return { edge: e.id, from: e.from, to: e.to, sign: e.sign === -1 ? -1 : 1, confidence: e.confidence };
}

function detail(loop: Loop, causal: GraphEdge[], all: Loop[]): LoopDetail {
  const members = new Set(loop.nodes);
  const steps = loop.edges.map((id) => step(causal.find((e) => e.id === id) as GraphEdge));
  const crossing = (inside: "from" | "to") => causal.filter((e) => members.has(e[inside]) && !members.has(e[inside === "to" ? "from" : "to"])).map(step);
  return {
    ...loop,
    steps,
    inputs: crossing("to"),
    outputs: crossing("from"),
    weakest: steps.reduce((a, b) => (b.confidence < a.confidence ? b : a)),
    certainty: steps.reduce((acc, s) => acc * s.confidence, 1),
    linkedLoops: all.filter((other) => other !== loop && other.nodes.some((n) => members.has(n))).length,
  };
}

export class AnalysisEngine {
  traceRoots(graph: Graph, roles: Roles, nodeId: string): RootTrace {
    const derivational = arcs(graph, roles, "derivational");
    const upstream = [...reachable(derivational, nodeId, "in")].filter((id) => id !== nodeId);
    const hasParent = new Set(derivational.map((a) => a.to));
    const roots = upstream
      .filter((id) => !hasParent.has(id))
      .map((id) => ({
        id,
        support: reachable(derivational, id, "out").size,
        path: shortestPath(derivational, id, nodeId) ?? [id, nodeId],
      }))
      .sort((a, b) => b.support - a.support || a.path.length - b.path.length);
    return { node: nodeId, upstream, roots };
  }

  findLoops(graph: Graph, roles: Roles, limit = 200): Loop[] {
    const causal = arcs(graph, roles, "causal");
    return elementaryCycles(causal, limit).map((cycle) => toLoop(cycle, graph.edges));
  }

  /** Loops with the structure around them: steps, brakes/accelerators, outputs, weakest link. */
  loopDetails(graph: Graph, roles: Roles, limit = 200): LoopDetail[] {
    const causal = arcs(graph, roles, "causal");
    const loops = this.findLoops(graph, roles, limit);
    return loops.map((loop) => detail(loop, causal, loops));
  }

  groups(graph: Graph, roles: Roles): string[][] {
    return components(arcs(graph, roles, "identity"));
  }

  diff(before: Graph, after: Graph): GraphDiff {
    return { nodes: diffRecords(before.nodes, after.nodes), edges: diffRecords(before.edges, after.edges) };
  }
}
