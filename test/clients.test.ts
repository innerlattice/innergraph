import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvariantError } from "../src/access/invariants.js";
import { formatFor, runCli } from "../src/clients/cli.js";
import { createApp, statusFor } from "../src/clients/http.js";
import { allowedTools, connectionNotice, createMcpServer, toolSpecs } from "../src/clients/mcp.js";
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

  it("serves the ingest, review and explore workflow", async () => {
    const app = createApp(t.vault);
    expect((await call(app, "/api/status")).json).toMatchObject({ model: "scripted", hosted: false });
    const added = await call(app, "/api/entries", { content: ENTRY_1, format: "markdown" });
    expect(added.status).toBe(200);
    await t.vault.queue.idle();
    expect((await call(app, `/api/jobs/${added.json.session}`)).json.state).toBe("done");
    const proposals = (await call(app, "/api/proposals")).json;
    expect(proposals).toHaveLength(1);
    const pending = proposals[0].items.filter((i: { decision: string }) => i.decision === "pending").map((i: { event: { id: string } }) => i.event.id);
    await call(app, `/api/proposals/${added.json.session}/review`, { accept: pending });
    expect((await call(app, `/api/proposals/${added.json.session}`)).json.pending).toBe(0);
    expect((await call(app, "/api/proposals?filter=all")).json).toHaveLength(1);

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

    await call(app, `/api/items/${shame.id}/attributes`, { label: "Shame (social)" });
    await call(app, `/api/items/${shame.id}/status`, { status: "accepted" });
    expect((await call(app, `/api/nodes/${shame.id}`)).json.node).toMatchObject({ label: "Shame (social)", status: "accepted" });
    t.gateway.generateJson = async () => ({ parts: [] });
    expect((await call(app, `/api/nodes/${memory.id}/split`, { parts: [{ label: "a" }, { label: "b" }] })).json.applied).toBe(true);
    const merged = await call(app, "/api/merge", { sources: [shame.id, memory.id], into: { label: "m" } });
    expect(merged.status).toBe(400);
    expect((await call(app, "/api/nodes/missing")).status).toBe(404);
    expect((await call(app, "/api/jobs/missing")).status).toBe(404);
  });
});

describe("MCP client", () => {
  it("gates tools by tier", () => {
    const specs = toolSpecs(t.vault, "agent:x");
    expect(allowedTools(specs, "read").map((s) => s.name)).not.toContain("propose");
    expect(allowedTools(specs, "propose").map((s) => s.name)).not.toContain("review");
    expect(allowedTools(specs, "commit")).toHaveLength(specs.length);
    expect(connectionNotice({ tier: "read", agent: "x" })).toContain("hosted");
  });

  it("lets a propose-tier agent add Entries and propose, but not review", async () => {
    const server = createMcpServer(t.vault, { tier: "propose", agent: "tester" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("propose");
    expect(tools).not.toContain("review");

    const text = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { body: result.content[0].text, isError: result.isError };
    };
    const added = JSON.parse((await text("add_entry", { content: ENTRY_1 })).body);
    await t.vault.queue.idle();
    const proposed = JSON.parse(
      (await text("propose", { entry: added.entry, nodes: [{ ref: "r", type: "process_node", label: "Rest", confidence: 0.4, quotes: ["When I rest properly"] }] })).body,
    );
    expect(proposed.accepted).toHaveLength(1);
    expect(JSON.parse((await text("get_schema")).body).name).toBe("author");
    expect(JSON.parse((await text("find_loops")).body)).toEqual([]);
    expect(JSON.parse((await text("list_proposals", { all: true })).body).length).toBe(2);
    expect(JSON.parse((await text("search_evidence", { query: "froze" })).body).length).toBeGreaterThan(0);
    expect(JSON.parse((await text("find_related", { text: "rest" })).body)).toBeInstanceOf(Array);
    expect(JSON.parse((await text("graph_at", { t: "2030-01-01" })).body).graph).toBeDefined();
    const missing = await text("get_node", { id: "missing" });
    expect(missing.isError).toBe(true);
    expect((await text("trace_roots", { id: "missing" })).isError).toBe(true);
    await client.close();
  });

  it("lets a commit-tier agent review", async () => {
    const { vault } = t;
    const added = vault.ingest.addEntry({ content: ENTRY_1 });
    await vault.queue.idle();
    const spec = toolSpecs(vault, "agent:x").find((s) => s.name === "review");
    const view = spec?.run({ session: added.session, reject: [] }) as { session: string };
    expect(view.session).toBe(added.session);
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
    await expect(runCli([], env)).rejects.toThrow("Usage");
    await expect(runCli(["serve", "--vault", join(tempDir(), "none")], env)).rejects.toThrow("No Vault");
  });

  it("infers input formats from file extensions", () => {
    expect(formatFor("a.md")).toBe("markdown");
    expect(formatFor("a.json")).toBe("chat-json");
    expect(formatFor("a.txt")).toBe("text");
    expect(formatFor("a.md", "text")).toBe("text");
  });
});
