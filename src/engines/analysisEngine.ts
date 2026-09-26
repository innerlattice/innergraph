// AnalysisEngine: structural queries over a Graph, driven only by Roles.
import type { Graph, GraphEdge, GraphNode, Role } from "../core/types.js";
import { type Arc, components, elementaryCycles, reachable, shortestPath } from "../utilities/graphAlgo.js";

export type Roles = Record<string, Role | undefined>;

export interface RootCandidate {
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

export interface ItemDiff<T> {
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

export function arcs(graph: Graph, roles: Roles, role: Role): GraphEdge[] {
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

  groups(graph: Graph, roles: Roles): string[][] {
    return components(arcs(graph, roles, "identity"));
  }

  diff(before: Graph, after: Graph): GraphDiff {
    return { nodes: diffRecords(before.nodes, after.nodes), edges: diffRecords(before.edges, after.edges) };
  }
}
