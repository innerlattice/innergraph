// Reading a conversation: which tool calls happened, how to say them in plain words, and which
// passages of the person's message they cite (highlighted in the message). Pure, no React.
import type { ChatMessage, ProposeResult } from "../api";
import { runsOf } from "../lib/format";

export interface ToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface CardItem {
  id: string;
  label: string;
}

export interface ToolCardInfo {
  name: string;
  phase: "running" | "done" | "error";
  /** Read tools are a quiet line; write tools a card with Undo. */
  quiet: boolean;
  title: string;
  items: CardItem[];
  notes: string[];
  session?: string;
  entry?: string;
  error?: string;
}

function toolName(part: { type: string }): string {
  return part.type.replace(/^tool-/, "");
}

export function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith("tool-");
}

function toolParts(messages: ChatMessage[]): ToolPart[] {
  return messages.flatMap((m) => (m.parts as { type: string }[]).filter(isToolPart));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** [while running, when done] for each tool the person may see. */
const WORDS: Record<string, [string, (out: Record<string, unknown>) => string]> = {
  record_entry: ["Saving your words", (o) => `Saved as an entry${o.title ? ` · ${o.title}` : ""}`],
  add_to_graph: ["Adding to your map", (o) => `Added ${plural((o.items as unknown[] | undefined)?.length ?? 0, "thing")} to your map`],
  amend: ["Adjusting", (o) => `Adjusted ${plural((o.changed as unknown[] | undefined)?.length ?? 0, "thing")}`],
  remove: ["Taking off the map", (o) => `Took ${plural((o.removed as unknown[] | undefined)?.length ?? 0, "thing")} off the map`],
  merge_nodes: ["Merging", () => "Merged into one"],
  split_node: ["Splitting", () => "Split into parts"],
  merge_duplicates: ["Merging duplicates", () => "Merged duplicates"],
  restore: ["Restoring", () => "Put something back"],
  undo: ["Undoing", () => "Undid a change"],
  undo_session: ["Undoing", () => "Undid a set of changes"],
  revert: ["Going back", () => "Went back to an earlier map"],
  revise_entry: ["Revising an entry", () => "Revised an entry"],
};

const LOOKUPS: Record<string, string> = {
  search_graph: "Searched your map",
  search_evidence: "Searched your writing",
  get_node: "Looked closer at something",
  trace_roots: "Traced where something comes from",
  find_loops: "Looked for loops",
  find_related: "Looked for related things",
  get_entry: "Read an entry",
  list_entries: "Looked over your entries",
  get_selection: "Checked what you selected",
  recent_changes: "Looked at recent changes",
  find_duplicates: "Looked for duplicates",
  graph_at: "Looked at an earlier map",
  get_schema: "Checked the map's vocabulary",
};

function phaseOf(part: ToolPart): ToolCardInfo["phase"] {
  if (part.state === "output-error") return "error";
  return part.state === "output-available" ? "done" : "running";
}

function itemsOf(name: string, out: Record<string, unknown>, labels: Record<string, string>): CardItem[] {
  if (name === "add_to_graph") return ((out.items as ProposeResult["items"] | undefined) ?? []).map((i) => ({ id: i.id, label: labels[i.id] ?? i.label }));
  const ids = (out.changed ?? out.removed) as string[] | undefined;
  return (ids ?? []).map((id) => ({ id, label: labels[id] ?? "an item" }));
}

function notesOf(out: Record<string, unknown>): string[] {
  const merged = (out.merged as unknown[] | undefined)?.length ?? 0;
  const dropped = (out.dropped as unknown[] | undefined)?.length ?? 0;
  return [merged ? `${plural(merged, "thing")} already on your map, so reused` : "", dropped ? `${plural(dropped, "quote")} didn't match your words and ${dropped === 1 ? "was" : "were"} left out` : ""].filter(Boolean);
}

/** A tool error, short enough for a card: malformed calls are the model's slip, not the person's. */
export function friendlyError(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (/InvalidToolInput|TypeValidation/.test(text)) return "The assistant sent an incomplete request; it can try again.";
  const first = text.split("\n")[0];
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/** One tool call in plain words. `labels` names items the output only gives ids for. */
export function describeTool(part: ToolPart, labels: Record<string, string> = {}): ToolCardInfo {
  const name = toolName(part);
  const phase = phaseOf(part);
  const words = WORDS[name];
  const out = (phase === "done" && part.output && typeof part.output === "object" ? part.output : {}) as Record<string, unknown>;
  const base = { name, phase, quiet: !words, items: itemsOf(name, out, labels), notes: notesOf(out), session: out.session as string | undefined, entry: out.entry as string | undefined, error: friendlyError(part.errorText) };
  if (!words) return { ...base, title: LOOKUPS[name] ?? "Looked something up" };
  const title = phase === "done" ? words[1](out) : phase === "error" ? `Couldn't finish: ${words[0].toLowerCase()}` : `${words[0]}…`;
  return { ...base, title };
}

export interface Mark {
  start: number;
  end: number;
  /** The items citing this passage; empty while they are still being added. */
  ids: string[];
  labels: string[];
}

interface Quoted {
  quotes?: string[];
  id?: string;
  label?: string;
}

const listOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : []);

/** Streaming input is partial JSON: any field may be missing or half-written. */
function quotedIn(part: ToolPart): Quoted[] {
  if (part.state === "output-available") return listOf<Quoted>((part.output as ProposeResult | undefined)?.items);
  const input = (part.input ?? {}) as { nodes?: unknown; edges?: unknown };
  return [...listOf<Quoted>(input.nodes), ...listOf<Quoted>(input.edges)].map((q) => ({ quotes: q.quotes, label: q.label }));
}

/** The Entry a user message was saved as, if the replies to it recorded one. */
export function recordedEntry(replies: ChatMessage[]): string | undefined {
  const saved = toolParts(replies).find((p) => toolName(p) === "record_entry" && p.state === "output-available");
  return (saved?.output as { entry?: string } | undefined)?.entry;
}

const cites = (part: ToolPart, entry: string) => toolName(part) === "add_to_graph" && part.state !== "output-error" && (part.input as { entry?: string } | undefined)?.entry === entry;

/** Where later add_to_graph calls citing `entry` quote `text` (that message's words): one Mark per found passage. */
export function marksFor(text: string, entry: string | undefined, later: ChatMessage[]): Mark[] {
  if (!entry) return [];
  return toolParts(later)
    .filter((p) => cites(p, entry))
    .flatMap(quotedIn)
    .flatMap((item) => marksOf(text, item));
}

function marksOf(text: string, item: Quoted): Mark[] {
  const quotes = (Array.isArray(item.quotes) ? item.quotes : []).filter((q) => typeof q === "string" && q.length > 0);
  const ids = item.id ? [item.id] : [];
  const labels = item.label ? [item.label] : [];
  return quotes.map((q) => ({ q, start: text.indexOf(q) })).filter((m) => m.start >= 0).map((m) => ({ start: m.start, end: m.start + m.q.length, ids, labels }));
}

export interface Segment {
  text: string;
  ids: string[];
  labels: string[];
  marked: boolean;
}

/** The text cut at every mark boundary; overlapping marks combine their items. */
export function segments(text: string, marks: Mark[]): Segment[] {
  return runsOf(text, marks).map(({ text: run, covering }) => ({
    text: run,
    ids: [...new Set(covering.flatMap((m) => m.ids))],
    labels: [...new Set(covering.flatMap((m) => m.labels))],
    marked: covering.length > 0,
  }));
}

/** The assistant messages answering the user message at `index`. */
export function repliesTo(messages: ChatMessage[], index: number): ChatMessage[] {
  const next = messages.findIndex((m, i) => i > index && m.role === "user");
  return messages.slice(index + 1, next < 0 ? undefined : next);
}

export function textOf(message: ChatMessage): string {
  return (message.parts as { type: string; text?: string }[]).map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** The latest context use a reply reported, or the stored figure. */
export function latestTokens(messages: ChatMessage[], stored: number): number {
  const reported = messages.map((m) => m.metadata?.contextTokens).filter((n): n is number => typeof n === "number");
  return reported.at(-1) ?? stored;
}

/** A 409 from the server, whose body says the conversation is full. */
export function isFullError(error: Error | undefined): boolean {
  return Boolean(error && /conversation is full/i.test(error.message));
}

/** The server's `{error}` body, or the message as is. */
export function errorText(error: Error): string {
  try {
    return (JSON.parse(error.message) as { error?: string }).error ?? error.message;
  } catch {
    return error.message;
  }
}

/** A finished reply with no words at all (small models sometimes stop after their tool calls). */
export function isSilent(message: ChatMessage | undefined): boolean {
  if (message?.role !== "assistant") return false;
  return !(message.parts as { type: string; text?: string }[]).some((p) => p.type === "text" && p.text?.trim());
}
