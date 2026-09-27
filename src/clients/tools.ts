// The agent surface: one registry of tools over the Managers, shared by every agent Client
// (MCP for external harnesses, the in-app chat). A read tier sees; write also changes the graph.
import { z } from "zod";
import type { ActorId } from "../core/types.js";
import type { Vault } from "../vault.js";

export type Tier = "read" | "write";

/** The --tier flag: write unless asked for read. */
export function tierOf(name: string | undefined): Tier {
  if (name === undefined || name === "write") return "write";
  if (name === "read") return "read";
  throw new Error(`Unknown tier "${name}": use read or write`);
}

export interface ToolSpec {
  name: string;
  tier: Tier;
  description: string;
  input: z.ZodRawShape;
  run: (args: Record<string, unknown>) => unknown;
}

const assertion = {
  entry: z.string().describe("Entry id (blob hash) the quotes come from"),
  nodes: z
    .array(
      z.object({
        ref: z.string().describe("A short name for this node within the call, used as an edge endpoint"),
        existing_id: z.string().nullish(),
        type: z.string(),
        label: z.string(),
        attributes: z.record(z.string(), z.unknown()).nullish(),
        confidence: z.number().min(0).max(1),
        quotes: z.array(z.string()).min(1).describe("Verbatim passages from the Entry"),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        from: z.string().describe("A node's ref from this call, or an existing node id"),
        to: z.string().describe("A node's ref from this call, or an existing node id"),
        type: z.string(),
        sign: z.enum(["+", "-"]).nullish(),
        confidence: z.number().min(0).max(1),
        quotes: z.array(z.string()).min(1),
      }),
    )
    .default([]),
};

/** Models often send `null` for a field they leave out; treat it as absent. */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, withoutNulls(v)]));
}

export function toolSpecs(vault: Vault, actor: ActorId): ToolSpec[] {
  return specsFor(vault, actor).map((spec) => ({ ...spec, run: (args) => spec.run(withoutNulls(args) as Record<string, unknown>) }));
}

function specsFor(vault: Vault, actor: ActorId): ToolSpec[] {
  const { explore, map, ingest } = vault;
  const text = (args: Record<string, unknown>, key: string) => String(args[key] ?? "");
  const ids = (args: Record<string, unknown>) => args.ids as string[];
  return [
    { name: "get_schema", tier: "read", description: "The Vault's current Schema: Node types, Edge types and Roles.", input: {}, run: () => explore.schema() },
    { name: "get_node", tier: "read", description: "A Node with its Evidence passages, Edges and lineage.", input: { id: z.string() }, run: (a) => explore.node(text(a, "id")) },
    {
      name: "search_graph",
      tier: "read",
      description:
        "Find the Nodes and Edges most relevant to what the user is talking about: pass their words (or a paraphrase). Hybrid lexical + embedding retrieval, fused and reranked. Use this to resolve names ('the hiding part', 'that loop about control') to ids.",
      input: { query: z.string(), limit: z.number().int().min(1).max(50).nullish() },
      run: (a) => explore.searchGraph(text(a, "query"), (a.limit as number | undefined) ?? 10),
    },
    { name: "search_evidence", tier: "read", description: "Case-insensitive search over Entry text; returns spans and the Nodes/Edges citing them.", input: { query: z.string() }, run: (a) => explore.searchEvidence(text(a, "query")) },
    { name: "trace_roots", tier: "read", description: "Follow derivational Edges upstream from a Node and rank candidate roots by downstream support.", input: { id: z.string() }, run: (a) => explore.traceRoots(text(a, "id")) },
    { name: "find_loops", tier: "read", description: "Feedback loops over causal Edges: polarity, each step with sign, confidence and quotes, outside brakes/accelerators, what the loop drives, and its least certain link. Offer implications as questions, not verdicts.", input: {}, run: () => explore.loopDetails() },
    { name: "find_related", tier: "read", description: "Related past Entries and Nodes for a text or Node id.", input: { text: z.string().nullish(), nodeId: z.string().nullish() }, run: (a) => explore.findRelated(a) },
    { name: "graph_at", tier: "read", description: "The Graph as it was at a time (ISO date) or HLC position.", input: { t: z.string() }, run: (a) => map.graphAt(text(a, "t")) },
    { name: "get_entry", tier: "read", description: "An Entry's full text and which Nodes/Edges cite which passages.", input: { id: z.string() }, run: (a) => explore.entry(text(a, "id")) },
    { name: "list_entries", tier: "read", description: "The latest version of every Entry, newest first.", input: {}, run: () => explore.entries() },
    { name: "get_selection", tier: "read", description: "The Nodes and Edges the user currently has selected in the graph view. Use when the user says 'these', 'the selected ones' or similar.", input: {}, run: () => explore.selection() },
    { name: "recent_changes", tier: "read", description: "What changed recently, grouped by Session (newest first): what was added, renamed, removed, merged. Use a Session id with undo_session.", input: { limit: z.number().int().min(1).max(100).nullish() }, run: (a) => explore.changes((a.limit as number | undefined) ?? 20) },
    {
      name: "add_entry",
      tier: "write",
      description: "Add a raw Entry (journal, transcript, reflection). By default the local model decomposes it; pass interpret=false to decompose it yourself with `add_to_graph`.",
      input: { content: z.string(), title: z.string().nullish(), format: z.enum(["text", "markdown", "chat-json"]).nullish(), interpret: z.boolean().nullish() },
      run: (a) => ingest.addEntry(a as never, { actor, interpret: a.interpret !== false }),
    },
    {
      name: "add_to_graph",
      tier: "write",
      description:
        "Add Nodes and Edges citing verbatim quotes from an Entry. They go straight onto the map, unconfirmed. Look up first (search_graph) and pass existing_id to reuse a Node; near-identical Nodes are merged automatically. Returns each item with the passages it cites.",
      input: assertion,
      run: (a) => ingest.propose(actor, text(a, "entry"), a),
    },
    {
      name: "revise_entry",
      tier: "write",
      description: "Replace an Entry's text with an edited version (e.g. a typo fix). Evidence moves to the same passages in the new text. With interpret=false, returns the cited items (label, attributes, old quotes, moved) so you can fix them yourself with `amend` and add new material with `add_to_graph`.",
      input: { entry: z.string(), content: z.string(), interpret: z.boolean().nullish() },
      run: (a) => ingest.reviseEntry(text(a, "entry"), text(a, "content"), { actor, interpret: a.interpret !== false }),
    },
    {
      name: "amend",
      tier: "write",
      description: "Rename or correct attributes of existing Nodes/Edges.",
      input: { changes: z.array(z.object({ id: z.string(), label: z.string().nullish(), attributes: z.record(z.string(), z.unknown()).nullish() })).min(1) },
      run: (a) => ingest.amend(actor, a.changes as never),
    },
    {
      name: "remove",
      tier: "write",
      description: "Take Nodes/Edges off the map (kept in history; restore brings them back). Resolve 'the selected ones' with get_selection.",
      input: { ids: z.array(z.string()).min(1), reason: z.string().nullish() },
      run: (a) => map.remove(ids(a), actor, a.reason as string | undefined),
    },
    {
      name: "merge_nodes",
      tier: "write",
      description: "Merge Nodes that are the same thing into one; Edges and evidence move to it and lineage is kept.",
      input: { ids: z.array(z.string()).min(2), label: z.string() },
      run: (a) => map.merge(ids(a), { label: text(a, "label") }, actor),
    },
    {
      name: "split_node",
      tier: "write",
      description: "Split a Node that holds several things into parts; its evidence and Edges are shared out between them.",
      input: { id: z.string(), parts: z.array(z.string()).min(2).describe("A label for each part") },
      run: (a) => map.split(text(a, "id"), (a.parts as string[]).map((label) => ({ label })), actor),
    },
    {
      name: "find_duplicates",
      tier: "read",
      description: "Existing duplicate Nodes (same type; same passage or near-identical label) and Edges (same endpoints and type).",
      input: {},
      run: () => map.duplicates(),
    },
    {
      name: "merge_duplicates",
      tier: "write",
      description: "Clean up all current duplicates: Nodes merged with lineage, extra Edges retired after their evidence moves to the oldest copy.",
      input: {},
      run: () => map.mergeDuplicates(actor),
    },
    {
      name: "restore",
      tier: "write",
      description: "Bring back a removed Node/Edge.",
      input: { id: z.string() },
      run: (a) => map.restore(text(a, "id"), actor),
    },
    {
      name: "undo",
      tier: "write",
      description: "Undo one Log Event: the items it touched return to how they were just before it.",
      input: { eventId: z.string() },
      run: (a) => map.undo(text(a, "eventId"), actor),
    },
    {
      name: "undo_session",
      tier: "write",
      description: "Undo everything one Session changed (see recent_changes), e.g. a whole decomposition.",
      input: { session: z.string() },
      run: (a) => map.undoSession(text(a, "session"), actor),
    },
    {
      name: "revert",
      tier: "write",
      description: "Return the whole graph to how it was at a time (ISO date) or HLC position, with new compensating Events (history is kept). Confirm with the user first.",
      input: { t: z.string() },
      run: (a) => map.revert(text(a, "t"), actor),
    },
  ];
}

export function allowedTools(specs: ToolSpec[], tier: Tier): ToolSpec[] {
  return specs.filter((spec) => tier === "write" || spec.tier === "read");
}

