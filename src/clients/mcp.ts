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
    { name: "search_evidence", tier: "read", description: "Case-insensitive search over Entry text; returns spans and the Nodes/Edges citing them.", input: { query: z.string() }, run: (a) => explore.searchEvidence(text(a, "query")) },
    { name: "trace_roots", tier: "read", description: "Follow derivational Edges upstream from a Node and rank candidate roots by downstream support.", input: { id: z.string() }, run: (a) => explore.traceRoots(text(a, "id")) },
    { name: "find_loops", tier: "read", description: "Feedback loops over causal Edges, classified reinforcing or balancing.", input: {}, run: () => explore.findLoops() },
    { name: "find_related", tier: "read", description: "Related past Entries and Nodes for a text or Node id. Parked Nodes are never returned.", input: { text: z.string().optional(), nodeId: z.string().optional() }, run: (a) => explore.findRelated(a) },
    { name: "graph_at", tier: "read", description: "The Graph as it was at a time (ISO date) or HLC position.", input: { t: z.string() }, run: (a) => map.graphAt(text(a, "t")) },
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
