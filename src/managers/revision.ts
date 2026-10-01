// Helpers for revising an Entry: which items cite it, and where their passages moved.
import type { VaultAccess } from "../access/vaultAccess.js";
import type { Evidence, GraphEdge, GraphNode, ProjectionState, SpanMove } from "../core/types.js";
import { diffChars } from "diff";
import { quoteToEvidence } from "../engines/evidenceLocator.js";
import { byteOffset } from "../utilities/crypto.js";
import type { CitedItem } from "../engines/interpretationEngine.js";

function spanKey(e: { start: number; end: number }): string {
  return `${e.start}:${e.end}`;
}

export interface BoundaryMap {
  /** Where a span starting at an old boundary starts in the new text. */
  start: number[];
  /** Where a span ending at an old boundary ends in the new text. */
  end: number[];
}

const SPACE = /\s/;

/** How text inserted at an old boundary attaches: to the word before, the word after, or neither. */
function attachment(oldText: string, at: number, inserted: string): "prev" | "next" | "none" {
  if (SPACE.test(inserted)) return "none";
  if (at > 0 && !SPACE.test(oldText[at - 1])) return "prev";
  return at < oldText.length && !SPACE.test(oldText[at]) ? "next" : "none";
}

function markBoundary(map: BoundaryMap, oldText: string, at: number, newPos: number, pending?: { before: number; text: string }): void {
  const attach = pending ? attachment(oldText, at, pending.text) : "none";
  map.start[at] = attach === "next" ? (pending as { before: number }).before : newPos;
  map.end[at] = pending && attach !== "prev" ? pending.before : newPos;
}

/**
 * Character-diff boundary maps from old text to new. Removed text collapses to where it was;
 * insertions without whitespace join the word they touch (so typo fixes stay inside a passage),
 * while inserted phrases are never absorbed into a neighbouring passage.
 */
export function boundaryMap(oldText: string, newText: string): BoundaryMap {
  const map: BoundaryMap = { start: [], end: [] };
  let oldPos = 0;
  let newPos = 0;
  let pending: { before: number; text: string } | undefined;
  for (const part of diffChars(oldText, newText)) {
    if (part.added) {
      pending = { before: pending?.before ?? newPos, text: (pending?.text ?? "") + part.value };
      newPos += part.value.length;
      continue;
    }
    markBoundary(map, oldText, oldPos, newPos, pending);
    pending = undefined;
    for (let i = 1; i < part.value.length; i++) map.start[oldPos + i] = map.end[oldPos + i] = part.removed ? newPos : newPos + i;
    oldPos += part.value.length;
    if (!part.removed) newPos += part.value.length;
  }
  markBoundary(map, oldText, oldText.length, newPos, pending);
  return map;
}

const SLACK_CHARS = 24;

function charAt(text: string, byte: number): number {
  return Buffer.from(text).subarray(0, byte).toString("utf8").length;
}

/** Maps a byte span of the old text into the new text; null if the passage was removed or ballooned. */
export function mapSpan(map: BoundaryMap, oldText: string, newText: string, span: { start: number; end: number }) {
  const s = charAt(oldText, span.start);
  const e = charAt(oldText, span.end);
  const start = map.start[s];
  const end = map.end[e];
  if (!(end > start) || end - start > (e - s) * 2 + SLACK_CHARS) return null;
  return { start: byteOffset(newText, start), end: byteOffset(newText, end) };
}

/** For each distinct span cited in the old Entry, where that passage sits in the new text. */
export function computeRemap(vault: VaultAccess, oldEntry: string, newEntry: string, newText: string, spans: Evidence[]): SpanMove[] {
  const unique = [...new Map(spans.map((s) => [spanKey(s), s])).values()];
  const oldText = vault.readText(oldEntry);
  const map = boundaryMap(oldText, newText);
  return unique.flatMap((span) => {
    const found = mapSpan(map, oldText, newText, span) ?? quoteToEvidence(newEntry, newText, vault.readSpan({ ...span, entry: oldEntry }));
    return found ? [{ from: { start: span.start, end: span.end }, to: { start: found.start, end: found.end } }] : [];
  });
}

function toCited(vault: VaultAccess, item: GraphNode | GraphEdge, graph: ProjectionState["graph"], entry: string, moved: Set<string>): CitedItem {
  const spans = item.evidence.filter((e) => e.entry === entry);
  const isNode = "label" in item;
  const label = isNode ? item.label : `${graph.nodes[item.from]?.label} —${item.type}→ ${graph.nodes[item.to]?.label}`;
  return {
    id: item.id,
    kind: isNode ? "node" : "edge",
    type: item.type,
    label,
    attributes: item.attributes,
    quotes: spans.map((s) => vault.readSpan(s)),
    moved: spans.some((s) => moved.has(spanKey(s))),
  };
}

/** Live Nodes/Edges that cite `entry`, with their passages and whether those survived the edit. */
export function citedItems(vault: VaultAccess, state: ProjectionState, entry: string, remap: SpanMove[] = []): CitedItem[] {
  const moved = new Set(remap.map((m) => spanKey(m.from)));
  const items = [...Object.values(state.graph.nodes), ...Object.values(state.graph.edges)];
  return items.filter((i) => !i.removed && i.evidence.some((e) => e.entry === entry)).map((i) => toCited(vault, i, state.graph, entry, moved));
}

export function citedSpans(state: ProjectionState, entry: string): Evidence[] {
  const items = [...Object.values(state.graph.nodes), ...Object.values(state.graph.edges)];
  return items.flatMap((i) => i.evidence.filter((e) => e.entry === entry));
}
