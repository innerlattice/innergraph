// Best-case experiment: a larger model (Claude) decomposes the fixtures itself and writes
// them into a fresh Vault through the MCP server, exactly as any external agent would.
//
//   npx tsx experiments/best-case/decompose.ts [vaultDir]
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runCli } from "../../src/clients/cli.js";

const ROOT = resolve(import.meta.dirname, "../..");
const HERE = import.meta.dirname;
const vaultDir = resolve(process.argv[2] ?? join(ROOT, ".experiments", "best-case"));

type ToolResult = { content: { text: string }[]; isError?: boolean };

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
}

async function decompose(client: Client, file: string): Promise<void> {
  const plan = JSON.parse(readFileSync(join(HERE, file), "utf8"));
  const content = readFileSync(join(ROOT, "test", "fixtures", plan.fixture), "utf8");
  const entry = (await call(client, "add_entry", { content, interpret: false })) as { entry: string };
  const proposed = (await call(client, "propose", { entry: entry.entry, nodes: plan.nodes, edges: plan.edges })) as {
    session: string;
    accepted: string[];
    awaitingReview: string[];
    dropped: string[];
  };
  console.log(`${plan.fixture}: ${proposed.accepted.length} auto-accepted, ${proposed.awaitingReview.length} for review, dropped: ${JSON.stringify(proposed.dropped)}`);
  if (proposed.awaitingReview.length > 0) await call(client, "review", { session: proposed.session, accept: proposed.awaitingReview });
}

async function main(): Promise<void> {
  await runCli(["init", "--vault", vaultDir], { log: console.log });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", join(ROOT, "src", "bin.ts"), "mcp", "--vault", vaultDir, "--tier", "commit", "--agent", "claude-opus-5.5"],
    stderr: "ignore",
  });
  const client = new Client({ name: "best-case-experiment", version: "1" });
  await client.connect(transport);
  for (const file of readdirSync(HERE).filter((f) => f.endsWith(".json")).sort()) await decompose(client, file);
  const loops = (await call(client, "find_loops")) as { nodes: string[]; polarity: string }[];
  const graph = (await call(client, "graph_at", { t: new Date(Date.now() + 60_000).toISOString() })) as {
    graph: { nodes: Record<string, { label: string }> };
  };
  for (const loop of loops) console.log(`${loop.polarity} loop: ${loop.nodes.map((id) => graph.graph.nodes[id]?.label).join(" → ")}`);
  await client.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
