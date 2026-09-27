// Best-case experiment: a larger model (Claude) decomposes the fixtures itself and writes
// them into a fresh Vault through the MCP server, exactly as any external agent would. A plan's
// node marked `"existing": true` reuses the node already on the map with that label. Then it seeds
// a few chats that show what the in-app assistant can do (chats.ts).
//
//   npm run fixture:reset          (stop the server on this vault first)
//   npx tsx experiments/best-case/decompose.ts [vaultDir] [--fresh]
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runCli } from "../../src/clients/cli.js";
import { openVault } from "../../src/vault.js";
import { seedChats, splitGateway } from "./chats.js";

const ROOT = resolve(import.meta.dirname, "../..");
const HERE = import.meta.dirname;
const vaultDir = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, ".experiments", "best-case"));

type ToolResult = { content: { text: string }[]; isError?: boolean };

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
}

interface PlanNode {
  existing?: boolean;
  label: string;
  [key: string]: unknown;
}

async function labelsNow(client: Client): Promise<Record<string, { label: string }>> {
  const at = (await call(client, "graph_at", { t: new Date(Date.now() + 60_000).toISOString() })) as { graph: { nodes: Record<string, { label: string }> } };
  return at.graph.nodes;
}

/** Points each node marked existing at the node on the map with its label. */
async function resolveExisting(client: Client, nodes: PlanNode[]): Promise<PlanNode[]> {
  const known = Object.entries(await labelsNow(client));
  return nodes.map(({ existing, ...node }) => {
    if (!existing) return node;
    const id = known.find(([, n]) => n.label === node.label)?.[0];
    if (!id) throw new Error(`No existing node labelled ${node.label}`);
    return { ...node, existing_id: id };
  });
}

async function decompose(client: Client, file: string): Promise<void> {
  const plan = JSON.parse(readFileSync(join(HERE, file), "utf8"));
  const content = readFileSync(join(ROOT, "test", "fixtures", plan.fixture), "utf8");
  const entry = (await call(client, "add_entry", { content, interpret: false })) as { entry: string };
  const nodes = await resolveExisting(client, plan.nodes);
  const added = (await call(client, "add_to_graph", { entry: entry.entry, nodes, edges: plan.edges })) as { items: unknown[]; dropped: string[] };
  console.log(`${plan.fixture}: ${added.items.length} items added, dropped: ${JSON.stringify(added.dropped)}`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--fresh")) rmSync(vaultDir, { recursive: true, force: true });
  await runCli(["init", "--vault", vaultDir], { log: console.log });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", join(ROOT, "src", "bin.ts"), "mcp", "--vault", vaultDir, "--tier", "write", "--agent", "claude-opus-5.5"],
    stderr: "ignore",
  });
  const client = new Client({ name: "best-case-experiment", version: "1" });
  await client.connect(transport);
  for (const file of readdirSync(HERE)
    .filter((f) => f.endsWith(".json"))
    .sort())
    await decompose(client, file);
  const loops = (await call(client, "find_loops")) as { nodes: string[]; polarity: string }[];
  const labels = await labelsNow(client);
  for (const loop of loops) console.log(`${loop.polarity} loop: ${loop.nodes.map((id) => labels[id]?.label).join(" → ")}`);
  await client.close();
  const vault = openVault({ dir: vaultDir, gateway: splitGateway, embedder: null, reranker: null });
  await seedChats(vault);
  console.log(`chats: ${vault.chat.list().length}`);
  vault.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
