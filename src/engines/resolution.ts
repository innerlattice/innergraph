// Entity resolution: decide whether a proposed Node/Edge is something already in the graph.
// Runs on every write path (local model, entry revisions, external agents), so nothing
// creates duplicates just because it did not look first. Stateless and theory-free.
import type { Evidence } from "../core/types.js";
import type { EdgeAssertion, Interpretation, NodeAssertion } from "./interpretationEngine.js";
import { tokenize } from "./recallEngine.js";

export interface KnownNode {
  id: string;
  type: string;
  label: string;
  evidence: Evidence[];
}

export interface KnownEdge {
  id: string;
  type: string;
  from: string;
  to: string;
}

export interface Resolved {
  result: Interpretation;
  /** New ids that were recognised as existing Nodes, and why. */
  merged: { id: string; into: string; reason: string }[];
}

/** Same thing: re-assert instead of creating. */
export const SAME = 0.8;
/** Possibly the same thing: create, but hold for review with the candidate named. */
const SIMILAR = 0.5;
const OVERLAP = 0.5;

/** Dice coefficient over content words; 1 for identical labels. */
export function labelSimilarity(a: string, b: string): number {
  const x = new Set(tokenize(a));
  const y = new Set(tokenize(b));
  if (x.size === 0 || y.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  const shared = [...x].filter((t) => y.has(t)).length;
  return (2 * shared) / (x.size + y.size);
}

/** True when two passages of the same Entry overlap by at least half the shorter one. */
export function spansOverlap(a: Evidence, b: Evidence): boolean {
  if (a.entry !== b.entry) return false;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return overlap > 0 && overlap >= OVERLAP * Math.min(a.end - a.start, b.end - b.start);
}

export interface Match {
  node: KnownNode;
  score: number;
  reason: string;
}

/** Best existing Node of the same type for an assertion: shared passage first, then label. */
export function bestMatch(assertion: NodeAssertion, known: KnownNode[]): Match | undefined {
  const scored = known
    .filter((k) => k.type === assertion.type && k.id !== assertion.id)
    .map((k) => {
      const shared = assertion.evidence.some((e) => k.evidence.some((f) => spansOverlap(e, f)));
      const label = labelSimilarity(assertion.label, k.label);
      return shared ? { node: k, score: 1, reason: "cites the same passage" } : { node: k, score: label, reason: "has a near-identical label" };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0];
}

function edgeKey(e: { from: string; type: string; to: string }): string {
  return `${e.from}|${e.type}|${e.to}`;
}

type Decision = { node: NodeAssertion; merged?: Resolved["merged"][number] };

function decide(node: NodeAssertion, pool: KnownNode[]): Decision {
  const match = bestMatch(node, pool);
  if (!match || match.score < SIMILAR) return { node };
  if (match.score < SAME) return { node: { ...node, similarTo: [match.node.id] } };
  return {
    node: { ...node, id: match.node.id, label: match.node.label, similarTo: undefined },
    merged: { id: node.id, into: match.node.id, reason: match.reason },
  };
}

function resolveNodes(nodes: NodeAssertion[], known: KnownNode[], merged: Resolved["merged"]): NodeAssertion[] {
  const knownIds = new Set(known.map((k) => k.id));
  const pool = [...known];
  return nodes.map((node) => {
    if (knownIds.has(node.id)) return node;
    const decision = decide(node, pool);
    if (decision.merged) merged.push(decision.merged);
    else pool.push({ id: node.id, type: node.type, label: node.label, evidence: node.evidence });
    return decision.node;
  });
}

function resolveEdges(edges: EdgeAssertion[], known: KnownEdge[], rename: Map<string, string>): EdgeAssertion[] {
  const existing = new Map(known.map((e) => [edgeKey(e), e.id]));
  const out = new Map<string, EdgeAssertion>();
  for (const edge of edges) {
    const renamed = { ...edge, from: rename.get(edge.from) ?? edge.from, to: rename.get(edge.to) ?? edge.to };
    const key = edgeKey(renamed);
    const id = existing.get(key) ?? out.get(key)?.id ?? renamed.id;
    const previous = out.get(key);
    out.set(key, previous ? { ...previous, evidence: [...previous.evidence, ...renamed.evidence] } : { ...renamed, id });
  }
  return [...out.values()];
}

function mergeAssertions(a: NodeAssertion, b: NodeAssertion): NodeAssertion {
  return { ...a, attributes: { ...a.attributes, ...b.attributes }, confidence: Math.max(a.confidence, b.confidence), evidence: [...a.evidence, ...b.evidence] };
}

/**
 * Rewrites an Interpretation against what already exists: Nodes that are the same thing
 * become re-assertions of the existing id; Edges between the same endpoints with the same
 * type reuse the existing Edge; near-matches are flagged with `similarTo`.
 */
export function resolve(result: Interpretation, known: { nodes: KnownNode[]; edges: KnownEdge[] }): Resolved {
  const merged: Resolved["merged"] = [];
  const nodes = resolveNodes(result.nodes, known.nodes, merged);
  const rename = new Map(merged.map((m) => [m.id, m.into]));
  const unique = [...nodes.reduce((acc, n) => acc.set(n.id, acc.has(n.id) ? mergeAssertions(acc.get(n.id) as NodeAssertion, n) : n), new Map<string, NodeAssertion>()).values()];
  return { result: { ...result, nodes: unique, edges: resolveEdges(result.edges, known.edges, rename) }, merged };
}
