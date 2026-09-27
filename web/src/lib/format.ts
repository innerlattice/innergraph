// Pure presentation helpers. No React, so they are easy to test.
import { edgeText } from "../../../src/core/edgeText";
import type { EventBodies, EventType } from "../../../src/core/types";
import type { AnyEvent, Graph, Schema } from "../api";

const PALETTE = ["#7c9885", "#b08968", "#8e7dbe", "#c97b84", "#5f8fa8", "#a3a35c", "#d4a373", "#6d8a96", "#9c6644", "#7a7aa8"];

export function colorFor(type: string, schema: Schema | null): string {
  const types = Object.keys(schema?.nodeTypes ?? {});
  const index = types.indexOf(type);
  return PALETTE[(index >= 0 ? index : type.length) % PALETTE.length];
}

export function formatHlc(hlc: string): string {
  const wall = Number(hlc.split(".")[0]);
  return new Date(wall).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Slice text by UTF-8 byte offsets, as Evidence pointers are stored. */
export function spanText(text: string, start: number, end: number): string {
  return decoder.decode(encoder.encode(text).slice(start, end));
}

export function charIndex(text: string, byteOffset: number): number {
  return spanText(text, 0, byteOffset).length;
}

export interface Segment {
  text: string;
  cited: string[];
}

/** Splits text into runs, each tagged with the targets whose Evidence covers it. */
export function highlightSegments(text: string, spans: { target: string; start: number; end: number }[]): Segment[] {
  const ranges = spans.map((s) => ({ target: s.target, from: charIndex(text, s.start), to: charIndex(text, s.end) }));
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.from, r.to])])].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];
    const cited = ranges.filter((r) => r.from <= from && r.to >= to).map((r) => r.target);
    segments.push({ text: text.slice(from, to), cited });
  }
  return segments.filter((s) => s.text.length > 0);
}

/** Anything shaped like a graph: the raw Graph or the materialized View. */
export interface GraphLike {
  nodes: Record<string, { id: string; label: string }>;
  edges: Record<string, { id: string; from: string; to: string; type: string }>;
}

export function labelsFrom(graph: GraphLike, events: AnyEvent[] = []): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const node of Object.values(graph.nodes)) labels[node.id] = node.label;
  for (const e of events) if (e.type === "NodeAsserted") labels[e.body.id] = e.body.label;
  const name = (id: string) => labels[id] ?? id.slice(-6);
  for (const edge of Object.values(graph.edges)) labels[edge.id] = edgeText(name(edge.from), edge.type, name(edge.to));
  return labels;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

type Name = (id: string) => string;
type Describers = { [K in EventType]?: (body: EventBodies[K], name: Name) => string };

function signMark(sign: number | undefined): string {
  if (sign === -1) return " (−)";
  return sign === 1 ? " (+)" : "";
}

const STATUS_WORDS: Record<string, string> = { superseded: "removed", accepted: "confirmed", hypothesis: "unconfirmed" };

const DESCRIBERS: Describers = {
  NodeAsserted: (b) => `${b.type}: “${b.label}” · ${pct(b.confidence)}`,
  EdgeAsserted: (b, name) => `${name(b.from)} —${b.type}${signMark(b.sign)}→ ${name(b.to)} · ${pct(b.confidence)}`,
  StatusChanged: (b, name) => `${name(b.target)} → ${STATUS_WORDS[b.status] ?? b.status}`,
  AttributesChanged: (b, name) => `edit ${name(b.target)}`,
  NodesSplit: (b, name) => `split ${name(b.source)} into ${b.into.map((p) => p.label).join(", ")}`,
  NodesMerged: (b, name) => `merge ${b.sources.map(name).join(" + ")} into “${b.into.label}”`,
  EntryAdded: (b) => `entry “${b.title}”`,
  SessionOpened: (b) => `session opened (${b.purpose})`,
  SchemaChanged: (b) => `schema “${b.schema.name}” v${b.schema.version}`,
};

export function describeEvent(e: AnyEvent, labels: Record<string, string>): string {
  const name = (id: string) => labels[id] ?? id.slice(-6);
  const describe = DESCRIBERS[e.type] as ((body: unknown, name: Name) => string) | undefined;
  return describe ? describe(e.body, name) : e.type;
}

export function actorLabel(actor: string): string {
  if (actor === "user") return "you";
  return actor.replace(/^(agent|model):/, "");
}

/** Encodes "open this Entry at this passage" as a navigation focus string. */
export function entryFocus(entry: string, start: number, end: number): string {
  return `${entry}@${start}-${end}`;
}

export function parseEntryFocus(focus: string | undefined): { entry?: string; span?: { start: number; end: number } } {
  if (!focus) return {};
  const match = /^(.+)@(\d+)-(\d+)$/.exec(focus);
  if (!match) return { entry: focus };
  return { entry: match[1], span: { start: Number(match[2]), end: Number(match[3]) } };
}
