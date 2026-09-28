// MCP Client: exposes Managers to any agent. A read connection sees; a write connection also
// changes the graph directly. Every change is one Session the person can undo.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION, skillText } from "../paths.js";
import type { Vault } from "../vault.js";
import { type Tier, allowedTools, toolSpecs } from "./tools.js";

export { type Tier, allowedTools, tierOf, toolSpecs } from "./tools.js";

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

export function createMcpServer(vault: Vault, options: McpOptions): McpServer {
  const server = new McpServer({ name: "inner-graph", version: VERSION }, { instructions: skillText() });
  const actor = `agent:${options.agent}`;
  for (const spec of allowedTools(toolSpecs(vault, actor), options.tier)) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input }, (args: Record<string, unknown>) => respond(() => spec.run(args)));
  }
  return server;
}

export function connectionNotice(options: McpOptions): string {
  return `inner-graph: tier "${options.tier}". Vault content returned here is read by the connected agent's model; if that model is hosted, it leaves this device.`;
}
