// Look up before writing: what the model is shown, and what every proposal is resolved
// against. Helpers for IngestManager; not a Manager.
import type { VaultAccess } from "../access/vaultAccess.js";
import type { GraphNode, ProjectionState } from "../core/types.js";
import type { ContextNode, Interpretation } from "../engines/interpretationEngine.js";
import { lexicalRanking } from "../engines/recallEngine.js";
import { type KnownEdge, type KnownNode, type Resolved, SAME, bestMatch, resolve } from "../engines/resolution.js";
import { graphDocs } from "./graphSearch.js";
import { ACTIVE, materialize } from "../access/view.js";

/** Graphs up to this size are shown to the model whole; larger ones are narrowed by retrieval. */
export const CONTEXT_LIMIT = 60;
const PER_SENTENCE = 8;

function live(n: GraphNode): boolean {
  return n.status === "hypothesis" || n.status === "accepted";
}

/** Everything a write could duplicate: every item on the map. */
function knownItems(state: ProjectionState): { nodes: KnownNode[]; edges: KnownEdge[] } {
  const view = materialize(state, ACTIVE);
  return { nodes: Object.values(view.nodes), edges: Object.values(view.edges) };
}

export function resolveAgainst(state: ProjectionState, result: Interpretation): Resolved {
  return resolve(result, knownItems(state));
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);
}

/**
 * Existing Nodes to show the model for an Entry: all of them for small graphs; otherwise
 * those most related to each sentence, plus everything the Entry already supports.
 */
export function contextFor(vault: VaultAccess, state: ProjectionState, text: string, entry?: string): ContextNode[] {
  const nodes = Object.values(state.graph.nodes).filter(live);
  const pick = (n: GraphNode) => ({ id: n.id, type: n.type, label: n.label });
  if (nodes.length <= CONTEXT_LIMIT) return nodes.map(pick);
  const docs = graphDocs(vault, state).filter((d) => d.kind === "node");
  const related = new Set(sentences(text).flatMap((s) => lexicalRanking(s, docs).slice(0, PER_SENTENCE).map((r) => docs[r.index].id)));
  const cited = nodes.filter((n) => n.evidence.some((e) => e.entry === entry)).map((n) => n.id);
  return nodes.filter((n) => related.has(n.id) || cited.includes(n.id)).map(pick);
}

export interface DuplicateGroup {
  kind: "node" | "edge";
  /** Oldest first: the one to keep. */
  ids: string[];
  reason: string;
}

function nodeGroups(nodes: GraphNode[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const ordered = [...nodes].sort((a, b) => a.assertedAt.localeCompare(b.assertedAt));
  for (const node of ordered) {
    if (seen.has(node.id)) continue;
    const same = ordered.filter((o) => o.id !== node.id && !seen.has(o.id) && isSame(node, o));
    if (same.length === 0) continue;
    for (const n of [node, ...same]) seen.add(n.id);
    groups.push({ kind: "node", ids: [node.id, ...same.map((s) => s.id)], reason: `duplicates of “${node.label}”` });
  }
  return groups;
}

function isSame(a: GraphNode, b: GraphNode): boolean {
  const match = bestMatch({ ...b, attributes: {}, confidence: 1 }, [a]);
  return match !== undefined && match.score >= SAME;
}

function edgeGroups(state: ProjectionState): DuplicateGroup[] {
  const byKey = new Map<string, string[]>();
  const live = Object.values(state.graph.edges).filter((e) => e.status !== "superseded");
  for (const e of live.sort((a, b) => a.assertedAt.localeCompare(b.assertedAt))) {
    const key = `${e.from}|${e.type}|${e.to}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e.id]);
  }
  return [...byKey.values()].filter((ids) => ids.length > 1).map((ids) => ({ kind: "edge" as const, ids, reason: "same endpoints and type" }));
}

/** Existing duplicates (e.g. from before resolution existed): same thing asserted more than once. */
export function findDuplicates(state: ProjectionState): DuplicateGroup[] {
  const nodes = Object.values(state.graph.nodes).filter(live);
  return [...nodeGroups(nodes), ...edgeGroups(state)];
}
