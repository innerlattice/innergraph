// CLI Client: init a Vault, serve the desktop UI, run the MCP server, add Entries.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { InputFormat } from "../access/ingestAccess.js";
import { loadSchemaFile } from "../access/schemaAccess.js";
import type { ModelGateway } from "../utilities/modelGateway.js";
import { type Vault, initVault, openVault, vaultExists } from "../vault.js";
import { createApp } from "./http.js";
import { type LaunchPlan, launchContext, planFor, writeAgentFiles } from "./launcher.js";
import { connectionNotice, createMcpServer, tierOf } from "./mcp.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const USAGE =
  "Usage: inner-graph [chat|init|serve|mcp|add|schema] [--vault dir] [--harness claude|<command>] [--schema file] [--port n] [--tier read|write] [--agent name]";

export interface CliEnv {
  log: (message: string) => void;
  gateway?: ModelGateway;
  key?: string;
  /** Runs a harness in the foreground and resolves with its exit code. */
  spawn?: (plan: LaunchPlan) => Promise<number>;
}

/** Something the caller can stop: a server, or nothing for one-shot commands. */
export interface Running {
  stop(): Promise<void>;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      vault: { type: "string", default: process.env.INNER_GRAPH_VAULT ?? join(homedir(), ".inner-graph", "default") },
      schema: { type: "string", default: join(ROOT, "schema", "author.yaml") },
      port: { type: "string", default: "4317" },
      tier: { type: "string" },
      harness: { type: "string", default: "claude" },
      agent: { type: "string", default: "mcp" },
      format: { type: "string" },
      "no-interpret": { type: "boolean", default: false },
    },
  });
}

type Parsed = ReturnType<typeof parse>;
type Command = (args: Parsed, env: CliEnv) => Promise<Running | undefined> | Running | undefined;

const EXTENSION_FORMATS: Record<string, InputFormat> = { ".md": "markdown", ".json": "chat-json" };

export function formatFor(file: string, explicit?: string): InputFormat {
  return (explicit as InputFormat | undefined) ?? EXTENSION_FORMATS[extname(file)] ?? "text";
}

function open(args: Parsed, env: CliEnv): Vault {
  const dir = args.values.vault;
  if (!vaultExists(dir)) throw new Error(`No Vault at ${dir}. Run "inner-graph init" first.`);
  return openVault({ dir, gateway: env.gateway, key: env.key });
}

function closeServer(server: ServerType, vault: Vault): Promise<void> {
  return new Promise((done) => server.close(() => done(vault.close())));
}

function startView(args: Parsed, env: CliEnv): Running {
  const vault = open(args, env);
  const app = createApp(vault);
  const dist = join(ROOT, "web", "dist");
  if (existsSync(dist)) app.use("/*", serveStatic({ root: dist }));
  const server = serve({ fetch: app.fetch, port: Number(args.values.port), hostname: "127.0.0.1" });
  const where = vault.gateway.hosted ? "HOSTED model: Entry text leaves this device" : "local model";
  env.log(`Inner Graph on http://127.0.0.1:${args.values.port} (${vault.gateway.name}, ${where})`);
  return { stop: () => closeServer(server, vault) };
}

export function spawnInForeground(plan: LaunchPlan): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, { stdio: "inherit", env: { ...process.env, ...plan.env } });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

const commands: Record<string, Command> = {
  init: ({ values }, env) => {
    initVault({ dir: values.vault, schemaFile: values.schema, key: env.key, gateway: env.gateway }).close();
    env.log(`Vault created at ${values.vault} with Schema ${values.schema}`);
    return undefined;
  },
  serve: (args, env) => startView(args, env),
  chat: async (args, env) => {
    const view = startView(args, env);
    const ctx = launchContext(ROOT, args.values.vault, { tier: tierOf(args.values.tier), agent: args.values.harness, port: args.values.port });
    writeAgentFiles(ctx);
    const plan = planFor(args.values.harness, ctx);
    env.log(`Starting ${args.values.harness} with the inner-graph skill and MCP (tier "${ctx.tier}"). Graph view: ${ctx.viewUrl}`);
    try {
      await (env.spawn ?? spawnInForeground)(plan);
    } finally {
      await view.stop();
    }
    return undefined;
  },
  mcp: async (args, env) => {
    const options = { tier: tierOf(args.values.tier), agent: args.values.agent };
    const vault = open(args, env);
    const server = createMcpServer(vault, options);
    env.log(connectionNotice(options));
    await server.connect(new StdioServerTransport());
    return { stop: async () => server.close().then(() => vault.close()) };
  },
  schema: (args, env) => {
    const file = args.positionals[1];
    if (!file) throw new Error("Usage: inner-graph schema <file>");
    const vault = open(args, env);
    vault.map.changeSchema(loadSchemaFile(file));
    vault.close();
    env.log(`Schema ${file} applied to ${args.values.vault}`);
    return undefined;
  },
  add: async (args, env) => {
    const file = args.positionals[1];
    if (!file) throw new Error("Usage: inner-graph add <file>");
    const vault = open(args, env);
    const input = { content: readFileSync(file, "utf8"), format: formatFor(file, args.values.format), source: file };
    const result = vault.ingest.addEntry(input, { interpret: !args.values["no-interpret"] });
    await vault.queue.idle();
    env.log(JSON.stringify({ ...result, job: result.job && vault.ingest.job(result.job.id) }, null, 2));
    vault.close();
    return undefined;
  },
};

export async function runCli(argv: string[], env: CliEnv): Promise<Running | undefined> {
  const args = parse(argv);
  const command = commands[args.positionals[0] ?? "chat"];
  if (!command) throw new Error(USAGE);
  return command(args, env);
}
