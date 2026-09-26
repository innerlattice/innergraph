// Documents and cached vectors for graph search. Helpers for ExploreManager; not a Manager.
import type { VaultAccess } from "../access/vaultAccess.js";
import { ACTIVE, type GraphView, type ViewEdge, type ViewNode, materialize } from "../access/view.js";
import type { ProjectionState } from "../core/types.js";
import type { RecallDoc } from "../engines/recallEngine.js";
import { sha256, utf8 } from "../utilities/crypto.js";
import type { Embedder } from "../utilities/modelGateway.js";

const BATCH = 32;

function values(attributes: Record<string, unknown>): string {
  return Object.values(attributes).filter((v) => typeof v === "string" && v).join("; ");
}

function edgeText(vault: VaultAccess, e: ViewEdge, view: GraphView): string {
  const sign = e.sign === -1 ? " (decreases)" : e.sign === 1 ? " (increases)" : "";
  const from = view.nodes[e.from]?.label ?? e.from;
  const to = view.nodes[e.to]?.label ?? e.to;
  return [`${from} ${e.type.replace(/_/g, " ")}${sign} ${to}`, ...e.evidence.map((ev) => vault.readSpan(ev))].join("\n");
}

function nodeText(vault: VaultAccess, n: ViewNode): string {
  return [`${n.label} (${n.type.replace(/_/g, " ")})`, values(n.attributes), ...n.evidence.map((ev) => vault.readSpan(ev))].filter(Boolean).join("\n");
}

/** Searchable items: everything on the map. Removed items never are. */
export function graphDocs(vault: VaultAccess, state: ProjectionState): RecallDoc[] {
  const view = materialize(state, ACTIVE);
  const nodes = Object.values(view.nodes).map((n) => ({ id: n.id, kind: "node" as const, text: nodeText(vault, n) }));
  const edges = Object.values(view.edges).map((e) => ({ id: e.id, kind: "edge" as const, text: edgeText(vault, e, view) }));
  return [...nodes, ...edges];
}

function toBytes(vector: number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(vector).buffer);
}

function fromBytes(bytes: Buffer): number[] {
  return Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
}

/** Embeds texts, reusing vectors cached in the Vault by model and content hash. */
export async function cachedVectors(vault: VaultAccess, embedder: Embedder, texts: string[]): Promise<number[][]> {
  const namespace = `embedding:${embedder.name}`;
  const keys = texts.map((t) => sha256(utf8(t)));
  const cached = vault.readCache(namespace, keys);
  const missing = [...new Set(keys.filter((k) => !cached.has(k)))];
  const byKey = new Map(keys.map((k, i) => [k, texts[i]]));
  const fresh = new Map<string, Uint8Array>();
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const vectors = await embedder.embed(batch.map((k) => byKey.get(k) as string));
    batch.forEach((k, j) => fresh.set(k, toBytes(vectors[j])));
  }
  if (fresh.size > 0) vault.writeCache(namespace, fresh);
  return keys.map((k) => fromBytes(Buffer.from(fresh.get(k) ?? (cached.get(k) as Buffer))));
}
