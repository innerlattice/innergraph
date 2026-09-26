// Look up before writing: what the model is shown, and what every proposal is resolved
// against. Helpers for IngestManager; not a Manager.
import type { VaultAccess } from "../access/vaultAccess.js";
import type { GraphNode, ProjectionState } from "../core/types.js";
import type { ContextNode, Interpretation } from "../engines/interpretationEngine.js";
import { lexicalRanking } from "../engines/recallEngine.js";
import { type KnownEdge, type KnownNode, type Resolved, resolve } from "../engines/resolution.js";
import { graphDocs } from "./graphSearch.js";
import { pendingAssertions } from "./pending.js";

/** Graphs up to this size are shown to the model whole; larger ones are narrowed by retrieval. */
export const CONTEXT_LIMIT = 60;
const PER_SENTENCE = 8;

function live(n: GraphNode): boolean {
  return n.status === "hypothesis" || n.status === "accepted";
}

/** Everything a proposal could duplicate: live and parked items plus other pending proposals. */
export function knownItems(state: ProjectionState): { nodes: KnownNode[]; edges: KnownEdge[] } {
  const pending = pendingAssertions(state).map((p) => p.item);
  const nodes = [...Object.values(state.graph.nodes).filter((n) => n.status !== "superseded"), ...pending.filter((p): p is GraphNode => "label" in p)];
  const edges = [...Object.values(state.graph.edges).filter((e) => e.status !== "superseded"), ...pending.filter((p) => "from" in p)] as KnownEdge[];
  return { nodes, edges };
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
