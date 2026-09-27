// Builds the Recall corpus from the head Projection. Parked Nodes are never included.
import type { VaultAccess } from "../access/vaultAccess.js";
import { ACTIVE, materialize } from "../access/view.js";
import type { ProjectionState } from "../core/types.js";
import type { RecallDoc, RecallMatch } from "../engines/recallEngine.js";

export interface RelatedItem extends RecallMatch {
  /** A node's label or an entry's title. */
  title: string;
  /** A node's type, so a reader can say what kind of thing it is. */
  nodeType?: string;
  snippet: string;
}

/** Recall offers what is on the map; removed items never come back. */
function recallable(state: ProjectionState) {
  return Object.values(materialize(state, ACTIVE).nodes);
}

export function buildCorpus(vault: VaultAccess, state: ProjectionState): RecallDoc[] {
  const entries = Object.keys(state.entries).map((id) => ({ id, kind: "entry" as const, text: vault.readText(id) }));
  const nodes = recallable(state).map((n) => ({
    id: n.id,
    kind: "node" as const,
    text: [n.label, ...n.evidence.map((e) => vault.readSpan(e))].join("\n"),
  }));
  return [...entries, ...nodes];
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat;
}

export function describeMatches(vault: VaultAccess, state: ProjectionState, matches: RecallMatch[]): RelatedItem[] {
  return matches.map((m) => {
    const node = state.graph.nodes[m.id];
    const title = node ? node.label : (state.entries[m.id]?.title ?? m.id);
    const first = node?.evidence[0];
    const text = first ? vault.readSpan(first) : node ? node.label : vault.readText(m.id);
    return { ...m, title, ...(node ? { nodeType: node.type } : {}), snippet: snippet(text) };
  });
}
