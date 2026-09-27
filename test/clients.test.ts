import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvariantError } from "../src/access/invariants.js";
import { formatFor, runCli, spawnInForeground } from "../src/clients/cli.js";
import type { LaunchPlan } from "../src/clients/launcher.js";
import { createApp, statusFor } from "../src/clients/http.js";
import { allowedTools, connectionNotice, createMcpServer, tierOf, toolSpecs } from "../src/clients/mcp.js";
import { ForbiddenError, NotFoundError } from "../src/managers/sessions.js";
import { ScriptedGateway } from "../src/utilities/modelGateway.js";
import { openVault } from "../src/vault.js";
import { ENTRY_1, INTERPRETATION_1, KEY, SCHEMA_FILE, type TestVault, makeVault, tempDir } from "./helpers.js";

let t: TestVault;
beforeEach(() => {
  t = makeVault([INTERPRETATION_1]);
});
afterEach(() => t.cleanup());

async function call(app: ReturnType<typeof createApp>, path: string, body?: unknown) {
  const init = body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const res = await app.request(path, init);
  return { status: res.status, json: await res.json() };
}

describe("HTTP client", () => {
  it("maps errors to status codes", () => {
    expect(statusFor(new NotFoundError())).toBe(404);
    expect(statusFor(new ForbiddenError())).toBe(403);
    expect(statusFor(new InvariantError())).toBe(400);
    expect(statusFor("weird")).toBe(400);
  });

  it("sends null as null, not as { ok: true }", async () => {
    vi.spyOn(t.vault.explore, "schema").mockReturnValue(null);
    expect((await call(createApp(t.vault), "/api/schema")).json).toBeNull();
  });

  it("serves the ingest, change and explore workflow", async () => {
    const app = createApp(t.vault);
    expect((await call(app, "/api/schema")).json).toHaveProperty("nodeTypes");
    const added = await call(app, "/api/entries", { content: ENTRY_1, format: "markdown" });
    expect(added.status).toBe(200);
    await t.vault.queue.idle();
    expect((await call(app, `/api/jobs/${added.json.session}`)).json.state).toBe("done");
    const changes = (await call(app, "/api/changes?limit=5")).json;
    expect(changes[0]).toMatchObject({ session: added.json.session, purpose: "ingest" });
    expect((await call(app, "/api/view?statuses=active,removed,bogus")).json.counts).toEqual({ active: 9, removed: 0 });

    const graph = (await call(app, "/api/graph")).json;
    const shame = Object.values(graph.nodes as Record<string, { id: string; label: string }>).find((n) => n.label === "Shame") as { id: string };
    const memory = Object.values(graph.nodes as Record<string, { id: string; label: string }>).find((n) => n.label.startsWith("Father")) as { id: string };
    expect((await call(app, `/api/nodes/${shame.id}`)).json.node.label).toBe("Shame");
    expect((await call(app, `/api/nodes/${shame.id}/roots`)).json.roots).toEqual([]);
    expect((await call(app, `/api/nodes/${shame.id}/related`)).status).toBe(200);
    expect((await call(app, "/api/loops")).json).toHaveLength(1);
    expect((await call(app, "/api/groups")).json).toEqual([]);
    expect((await call(app, "/api/schema")).json.name).toBe("author");
    expect((await call(app, "/api/entries")).json).toHaveLength(1);
    expect((await call(app, `/api/entries/${added.json.entry}`)).json.citations.length).toBeGreaterThan(0);
    expect((await call(app, "/api/search?q=froze")).json.length).toBeGreaterThan(0);
    expect((await call(app, "/api/timeline")).json.length).toBeGreaterThan(5);
    const positions = (await call(app, "/api/positions")).json as string[];
    expect((await call(app, `/api/graph/at?t=${positions[0]}`)).json.graph.nodes).toEqual({});
    expect((await call(app, `/api/diff?from=${positions[0]}&to=${positions.at(-1)}`)).json.nodes.added).toHaveLength(5);
    expect((await call(app, "/api/graph?superseded=1")).status).toBe(200);
    expect((await call(app, "/api/related", { text: "shame" })).status).toBe(200);
    expect((await call(app, "/api/search/graph?q=shame&limit=5")).json.hits.map((h: { label: string }) => h.label)).toContain("Shame");
    expect((await call(app, "/api/search/graph")).json.stages).toEqual(["lexical"]);

    const put = await app.request("/api/selection", { method: "PUT", body: JSON.stringify({ ids: [shame.id, "gone", shame.id] }), headers: { "content-type": "application/json" } });
    expect((await put.json()).ids).toEqual([shame.id, "gone"]);
    expect((await call(app, "/api/selection")).json.items.map((i: { label: string }) => i.label)).toEqual(["Shame"]);
    const edgeId = Object.keys(graph.edges)[0];
    await app.request("/api/selection", { method: "PUT", body: JSON.stringify({ ids: [edgeId] }), headers: { "content-type": "application/json" } });
    expect((await call(app, "/api/selection")).json.items[0].kind).toBe("edge");
    await app.request("/api/selection", { method: "PUT", body: JSON.stringify({}), headers: { "content-type": "application/json" } });

    await call(app, `/api/items/${shame.id}/attributes`, { label: "Shame (social)" });
    await call(app, "/api/confirm", { ids: [shame.id] });
    expect((await call(app, `/api/nodes/${shame.id}`)).json.node).toMatchObject({ label: "Shame (social)", status: "active", confirmed: true });
    expect((await call(app, "/api/remove", { ids: [shame.id] })).json.removed).toEqual([shame.id]);
    expect((await call(app, "/api/undo-session", { session: added.json.session })).status).toBe(200);
    expect((await call(app, "/api/undo-session", {})).status).toBe(404);
    t.gateway.generateJson = async () => ({ parts: [] });
    expect((await call(app, `/api/nodes/${memory.id}/split`, { parts: [{ label: "a" }, { label: "b" }] })).status).toBe(400);
    const merged = await call(app, "/api/merge", { sources: [shame.id, memory.id], into: { label: "m" } });
    expect(merged.status).toBe(400);
    expect((await call(app, "/api/nodes/missing")).status).toBe(404);
    const anEdge = Object.keys(graph.edges)[0];
    expect((await call(app, `/api/edges/${anEdge}`)).json.fromLabel).toBeTruthy();
    expect((await call(app, "/api/edges/missing")).status).toBe(404);
    expect((await call(app, `/api/revert/preview?t=${positions[0]}`)).json).toHaveProperty("retired");
    expect((await call(app, "/api/duplicates")).json).toEqual([]);
    expect((await call(app, "/api/duplicates/merge", {})).json).toEqual([]);
    const undoTarget = (await call(app, "/api/timeline")).json.find((e: { type: string }) => e.type === "AttributesChanged");
    expect((await call(app, "/api/undo", { eventId: undoTarget.id })).status).toBe(200);
    expect((await call(app, "/api/restore", { id: "nope" })).status).toBe(404);
    expect((await call(app, "/api/revert", { t: positions.at(-1) })).status).toBe(200);
    expect((await call(app, "/api/jobs/missing")).status).toBe(404);
  });
});

describe("live stream", () => {
  it("emits the Log position when it changes", async () => {
    const app = createApp(t.vault);
    const res = await app.request("/api/stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: position");
    t.vault.ingest.addEntry({ content: "live" }, { interpret: false });
    const next = new TextDecoder().decode((await reader.read()).value);
    expect(next).toContain("data:");
    await reader.cancel();
  });
});

describe("MCP client", () => {
  it("gates tools by tier", () => {
    const specs = toolSpecs(t.vault, "agent:x");
    expect(allowedTools(specs, "read").map((s) => s.name)).not.toContain("add_to_graph");
    expect(allowedTools(specs, "write")).toHaveLength(specs.length);
    expect([tierOf("read"), tierOf("write"), tierOf(undefined)]).toEqual(["read", "write", "write"]);
    expect(() => tierOf("commit")).toThrow(/Unknown tier/);
    expect(connectionNotice({ tier: "read", agent: "x" })).toContain("hosted");
  });

  it("lets a write-tier agent add Entries and change the graph", async () => {
    const server = createMcpServer(t.vault, { tier: "write", agent: "tester" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("add_to_graph");

    const text = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { body: result.content[0].text, isError: result.isError };
    };
    const stored = JSON.parse((await text("add_entry", { content: "Kept for my own decomposition.", interpret: false })).body);
    expect(stored.job).toBeUndefined();
    const added = JSON.parse((await text("add_entry", { content: ENTRY_1 })).body);
    await t.vault.queue.idle();
    const proposed = JSON.parse(
      (await text("add_to_graph", { entry: added.entry, nodes: [{ ref: "r", type: "process_node", label: "Rest", confidence: 0.4, quotes: ["When I rest properly"] }] })).body,
    );
    expect(proposed.items[0]).toMatchObject({ kind: "node", label: "Rest" });
    expect(proposed.items[0].evidence).toHaveLength(1);
    expect(JSON.parse((await text("get_schema")).body).name).toBe("author");
    expect(JSON.parse((await text("get_selection")).body).items).toEqual([]);
    expect(JSON.parse((await text("search_graph", { query: "rest" })).body).hits[0].label).toBe("Rest");
    expect(JSON.parse((await text("search_graph", { query: "rest", limit: 1 })).body).hits).toHaveLength(1);
    expect(JSON.parse((await text("find_loops")).body)).toHaveLength(1);
    expect(JSON.parse((await text("recent_changes", { limit: 2 })).body)).toHaveLength(2);
    expect(JSON.parse((await text("search_evidence", { query: "froze" })).body).length).toBeGreaterThan(0);
    expect(JSON.parse((await text("find_related", { text: "rest" })).body)).toBeInstanceOf(Array);
    expect(JSON.parse((await text("graph_at", { t: "2030-01-01" })).body).graph).toBeDefined();
    const missing = await text("get_node", { id: "missing" });
    expect(missing.isError).toBe(true);
    expect((await text("trace_roots", { id: "missing" })).isError).toBe(true);
    await client.close();
  });

  it("lets a write-tier agent remove, merge, split, restore and undo", async () => {
    const { vault } = t;
    const added = vault.ingest.addEntry({ content: ENTRY_1 });
    await vault.queue.idle();
    const tool = (name: string) => toolSpecs(vault, "agent:x").find((s) => s.name === name);
    const nodes = Object.values(vault.explore.graph().nodes);
    const [first, second, third] = nodes.map((n) => n.id);
    expect(tool("remove")?.run({ ids: [first] })).toMatchObject({ removed: [first] });
    tool("restore")?.run({ id: first });
    expect(vault.explore.graph().nodes[first]).toBeDefined();
    tool("merge_nodes")?.run({ ids: [first, second], label: "Both" });
    t.gateway.generateJson = async () => ({ parts: [{ evidence: [], edges: [] }, { evidence: [], edges: [] }] });
    await tool("split_node")?.run({ id: third, parts: ["A", "B"] });
    const undoable = vault.explore.timeline(5).find((e) => e.type === "NodesSplit")?.id;
    expect(() => tool("undo")?.run({ eventId: undoable })).not.toThrow();
    expect(tool("undo_session")?.run({ session: added.session })).toHaveProperty("summary");
    expect(tool("revert")?.run({ t: "2020-01-01" })).toHaveProperty("summary");
    expect(tool("find_duplicates")?.run({})).toEqual([]);
    expect(tool("merge_duplicates")?.run({})).toEqual([]);
  });
});

describe("CLI client", () => {
  it("initialises a Vault, adds an Entry and serves the API", async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const env = { log: (m: string) => void lines.push(m), key: KEY, gateway: new ScriptedGateway([INTERPRETATION_1]) };
    await runCli(["init", "--vault", dir, "--schema", SCHEMA_FILE], env);
    await expect(runCli(["init", "--vault", dir], env)).rejects.toThrow("already exists");
    const file = join(dir, "entry.md");
    writeFileSync(file, ENTRY_1);
    await runCli(["add", file, "--vault", dir], env);
    expect(JSON.parse(lines.at(-1) as string).job.state).toBe("done");
    await expect(runCli(["add", "--vault", dir], env)).rejects.toThrow("Usage");
    const next = join(dir, "next.yaml");
    writeFileSync(next, readFileSync(SCHEMA_FILE, "utf8").replace(/^version: \d+$/m, "version: 99"));
    await runCli(["schema", next, "--vault", dir], env);
    expect(lines.at(-1)).toContain("applied");
    await expect(runCli(["schema", "--vault", dir], env)).rejects.toThrow("Usage");

    const running = await runCli(["serve", "--vault", dir, "--port", "43917"], env);
    const res = await fetch("http://127.0.0.1:43917/api/entries");
    expect(await res.json()).toHaveLength(1);
    await running?.stop();

    const vault = openVault({ dir, key: KEY, gateway: env.gateway });
    expect(vault.explore.entries()).toHaveLength(1);
    vault.close();
    rmSync(dir, { recursive: true });
  });

  it("explains usage and missing Vaults", async () => {
    const env = { log: () => {} };
    await expect(runCli(["bogus"], env)).rejects.toThrow("Usage");
    await expect(runCli(["serve", "--vault", join(tempDir(), "none")], env)).rejects.toThrow("No Vault");
  });

  it("chat serves the graph view, writes agent files and runs the harness", async () => {
    const dir = tempDir();
    const env = { log: () => {}, key: KEY, gateway: new ScriptedGateway([]) };
    await runCli(["init", "--vault", dir, "--schema", SCHEMA_FILE], env);
    const plans: LaunchPlan[] = [];
    const spawnFake = async (plan: LaunchPlan) => {
      plans.push(plan);
      const res = await fetch("http://127.0.0.1:43918/api/schema");
      expect(res.status).toBe(200);
      return 0;
    };
    await runCli(["--vault", dir, "--port", "43918", "--harness", "my-agent --flag"], { ...env, spawn: spawnFake });
    expect(plans[0]).toMatchObject({ command: "my-agent", args: ["--flag"], env: { INNER_GRAPH_VAULT: dir, INNER_GRAPH_VIEW: "http://127.0.0.1:43918" } });
    const config = JSON.parse(readFileSync(join(dir, "agent", "mcp.json"), "utf8"));
    expect(config.mcpServers["inner-graph"].args).toEqual(expect.arrayContaining(["mcp", "--tier", "write", "--agent", "my-agent --flag"]));
    await expect(fetch("http://127.0.0.1:43918/api/schema")).rejects.toThrow();
    rmSync(dir, { recursive: true });
  });

  it("runs a harness in the foreground and reports its exit code", async () => {
    expect(await spawnInForeground({ command: process.execPath, args: ["-e", "process.exit(3)"], env: { X: "1" } })).toBe(3);
    await expect(spawnInForeground({ command: "/nonexistent/harness", args: [], env: {} })).rejects.toThrow();
  });

  it("infers input formats from file extensions", () => {
    expect(formatFor("a.md")).toBe("markdown");
    expect(formatFor("a.json")).toBe("chat-json");
    expect(formatFor("a.txt")).toBe("text");
    expect(formatFor("a.md", "text")).toBe("text");
  });
});
