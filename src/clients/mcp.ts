// MCP Client: exposes Managers to any agent. Tools are gated by the connection's tier.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActorId } from "../core/types.js";
import type { Vault } from "../vault.js";

export type Tier = "read" | "propose" | "commit";

const TIER_RANK: Record<Tier, number> = { read: 0, propose: 1, commit: 2 };

export interface McpOptions {
  tier: Tier;
  agent: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function respond(work: () => unknown): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

interface ToolSpec {
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
        ref: z.string(),
        existing_id: z.string().optional(),
        type: z.string(),
        label: z.string(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        confidence: z.number().min(0).max(1),
        quotes: z.array(z.string()).min(1).describe("Verbatim passages from the Entry"),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.string(),
        sign: z.enum(["+", "-"]).optional(),
        confidence: z.number().min(0).max(1),
        quotes: z.array(z.string()).min(1),
      }),
    )
    .default([]),
};

export function toolSpecs(vault: Vault, actor: ActorId): ToolSpec[] {
  const { explore, map, ingest } = vault;
  const text = (args: Record<string, unknown>, key: string) => String(args[key] ?? "");
  return [
    { name: "get_schema", tier: "read", description: "The Vault's current Schema: Node types, Edge types and Roles.", input: {}, run: () => explore.schema() },
    { name: "get_node", tier: "read", description: "A Node with its Evidence passages, Edges and lineage.", input: { id: z.string() }, run: (a) => explore.node(text(a, "id")) },
    {
      name: "search_graph",
      tier: "read",
      description:
        "Find the Nodes and Edges most relevant to what the user is talking about: pass their words (or a paraphrase). Hybrid lexical + embedding retrieval, fused and reranked. Use this to resolve names ('the hiding part', 'that loop about control') to ids. Parked items never appear.",
      input: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
      run: (a) => explore.searchGraph(text(a, "query"), (a.limit as number | undefined) ?? 10),
    },
    { name: "search_evidence", tier: "read", description: "Case-insensitive search over Entry text; returns spans and the Nodes/Edges citing them.", input: { query: z.string() }, run: (a) => explore.searchEvidence(text(a, "query")) },
    { name: "trace_roots", tier: "read", description: "Follow derivational Edges upstream from a Node and rank candidate roots by downstream support.", input: { id: z.string() }, run: (a) => explore.traceRoots(text(a, "id")) },
    { name: "find_loops", tier: "read", description: "Feedback loops over causal Edges: polarity, each step with sign, confidence and quotes, outside brakes/accelerators, what the loop drives, and its least certain link. Offer implications as questions, not verdicts.", input: {}, run: () => explore.loopDetails() },
    { name: "find_related", tier: "read", description: "Related past Entries and Nodes for a text or Node id. Parked Nodes are never returned.", input: { text: z.string().optional(), nodeId: z.string().optional() }, run: (a) => explore.findRelated(a) },
    { name: "graph_at", tier: "read", description: "The Graph as it was at a time (ISO date) or HLC position.", input: { t: z.string() }, run: (a) => map.graphAt(text(a, "t")) },
    { name: "get_entry", tier: "read", description: "An Entry's full text and which Nodes/Edges cite which passages.", input: { id: z.string() }, run: (a) => explore.entry(text(a, "id")) },
    { name: "list_entries", tier: "read", description: "The latest version of every Entry, newest first.", input: {}, run: () => explore.entries() },
    { name: "get_selection", tier: "read", description: "The Nodes and Edges the user currently has selected in the graph view. Use when the user says 'these', 'the selected ones' or similar.", input: {}, run: () => explore.selection() },
    { name: "list_proposals", tier: "read", description: "Proposals with Events awaiting review, and why each was surfaced.", input: { all: z.boolean().optional() }, run: (a) => ingest.listProposals(a.all ? "all" : "pending") },
    {
      name: "add_entry",
      tier: "propose",
      description: "Add a raw Entry (journal, transcript, reflection). By default the local model interprets it into a Proposal; pass interpret=false to decompose it yourself with `propose`.",
      input: { content: z.string(), title: z.string().optional(), format: z.enum(["text", "markdown", "chat-json"]).optional(), interpret: z.boolean().optional() },
      run: (a) => ingest.addEntry(a as never, { actor, interpret: a.interpret !== false }),
    },
    { name: "propose", tier: "propose", description: "Propose Nodes and Edges citing verbatim quotes from an Entry. Low-impact items are auto-accepted as hypotheses; the rest await review.", input: assertion, run: (a) => ingest.propose(actor, text(a, "entry"), a) },
    {
      name: "revise_entry",
      tier: "propose",
      description: "Replace an Entry's text with an edited version (e.g. a typo fix). Evidence moves to the same passages in the new text. With interpret=false, returns the cited items (label, attributes, old quotes, moved) so you can fix them yourself with `amend` and add new material with `propose`.",
      input: { entry: z.string(), content: z.string(), interpret: z.boolean().optional() },
      run: (a) => ingest.reviseEntry(text(a, "entry"), text(a, "content"), { actor, interpret: a.interpret !== false }),
    },
    {
      name: "amend",
      tier: "propose",
      description: "Correct labels or attributes of existing Nodes/Edges, e.g. after an Entry was edited. Low-impact, so usually merged automatically.",
      input: { changes: z.array(z.object({ id: z.string(), label: z.string().optional(), attributes: z.record(z.string(), z.unknown()).optional() })).min(1) },
      run: (a) => ingest.amend(actor, a.changes as never),
    },
    {
      name: "approve",
      tier: "commit",
      description: "Approve Nodes/Edges by id: merges proposed items and marks hypotheses accepted. Resolve 'the selected ones' with get_selection, and names or chains with search_graph or get_node. Never approve on your own initiative; only when the user asks.",
      input: { ids: z.array(z.string()).min(1) },
      run: (a) => ingest.approve(a.ids as string[], actor),
    },
    {
      name: "decline",
      tier: "commit",
      description: "Decline Nodes/Edges by id: rejects proposed items (and edges that depend on them) and retires merged hypotheses. Only when the user asks.",
      input: { ids: z.array(z.string()).min(1) },
      run: (a) => ingest.decline(a.ids as string[], actor),
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
      tier: "propose",
      description: "Propose cleaning up all current duplicates: Nodes merged with lineage, extra Edges retired after their evidence moves to the oldest copy. Arrives as proposals the user reviews.",
      input: {},
      run: () => map.mergeDuplicates(actor),
    },
    {
      name: "restore",
      tier: "commit",
      description: "Bring back a Node/Edge the user declined or that was retired (e.g. declined by accident). Only when the user asks.",
      input: { id: z.string() },
      run: (a) => map.restore(text(a, "id"), actor),
    },
    {
      name: "undo",
      tier: "commit",
      description: "Undo one Log Event: the items it touched return to how they were just before it. Only when the user asks.",
      input: { eventId: z.string() },
      run: (a) => map.undo(text(a, "eventId"), actor),
    },
    {
      name: "revert",
      tier: "commit",
      description: "Return the whole graph to how it was at a time (ISO date) or HLC position, with new compensating Events (history is kept). Confirm with the user first; parked items are never touched.",
      input: { t: z.string() },
      run: (a) => map.revert(text(a, "t"), actor),
    },
    { name: "review", tier: "commit", description: "Accept or reject Events in a Proposal.", input: { session: z.string(), accept: z.array(z.string()).optional(), reject: z.array(z.string()).optional() }, run: (a) => ingest.review(text(a, "session"), a, actor) },
  ];
}

export function allowedTools(specs: ToolSpec[], tier: Tier): ToolSpec[] {
  return specs.filter((spec) => TIER_RANK[spec.tier] <= TIER_RANK[tier]);
}

export function createMcpServer(vault: Vault, options: McpOptions): McpServer {
  const server = new McpServer({ name: "inner-graph", version: "0.1.0" });
  const actor = `agent:${options.agent}`;
  for (const spec of allowedTools(toolSpecs(vault, actor), options.tier)) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input }, (args: Record<string, unknown>) =>
      respond(() => spec.run(args)),
    );
  }
  return server;
}

export function connectionNotice(options: McpOptions): string {
  return `inner-graph: tier "${options.tier}". Vault content returned here is read by the connected agent's model; if that model is hosted, it leaves this device.`;
}
