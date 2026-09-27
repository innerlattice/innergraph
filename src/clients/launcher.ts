// Launcher: the main interface. Starts the graph view and boots an agent harness wired to the
// Inner Graph MCP server and skill. Harnesses are adapters; adding one is one table entry.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Runner, SERVER_NAME, mcpLaunch, serverEntry } from "./connect.js";
import type { Tier } from "./mcp.js";

export interface LaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface LaunchContext {
  root: string;
  vault: string;
  tier: Tier;
  agent: string;
  viewUrl: string;
  /** Files written for harnesses that take configuration by path. */
  mcpConfigFile: string;
  skillFile: string;
  pluginDir: string;
}

/** This program run from source, as in development. */
export function sourceRunner(root: string): Runner {
  return { command: join(root, "node_modules", ".bin", "tsx"), prefix: [join(root, "src", "bin.ts")] };
}

export function mcpServerConfig(ctx: LaunchContext) {
  return { mcpServers: { [SERVER_NAME]: serverEntry(mcpLaunch(sourceRunner(ctx.root), ctx.vault, ctx.tier, ctx.agent)) } };
}

function baseEnv(ctx: LaunchContext): Record<string, string> {
  return { INNER_GRAPH_VAULT: ctx.vault, INNER_GRAPH_MCP_CONFIG: ctx.mcpConfigFile, INNER_GRAPH_SKILL: ctx.skillFile, INNER_GRAPH_VIEW: ctx.viewUrl };
}

/** `claude` is often a shell alias; fall back to the local install path. */
export function claudeCommand(env: NodeJS.ProcessEnv = process.env): string {
  if (env.INNER_GRAPH_CLAUDE) return env.INNER_GRAPH_CLAUDE;
  const local = join(homedir(), ".claude", "local", "claude");
  return existsSync(local) ? local : "claude";
}

const VIEW_NOTE = (ctx: LaunchContext) => `The person is watching the graph live at ${ctx.viewUrl}.`;

export const HARNESSES: Record<string, (ctx: LaunchContext) => LaunchPlan> = {
  claude: (ctx) => ({
    command: claudeCommand(),
    args: ["--plugin-dir", ctx.pluginDir, "--mcp-config", JSON.stringify(mcpServerConfig(ctx)), "--append-system-prompt", `${VIEW_NOTE(ctx)} Use the inner-graph skill.`],
    env: baseEnv(ctx),
  }),
};

/** Any other harness: run a command with the config and skill paths in the environment. */
export function customPlan(command: string, ctx: LaunchContext): LaunchPlan {
  const [cmd, ...args] = command.split(" ").filter(Boolean);
  return { command: cmd, args, env: baseEnv(ctx) };
}

export function planFor(harness: string, ctx: LaunchContext): LaunchPlan {
  const adapter = HARNESSES[harness];
  return adapter ? adapter(ctx) : customPlan(harness, ctx);
}

/** Writes the MCP config next to the Vault so path-based harnesses can load it. */
export function writeAgentFiles(ctx: LaunchContext): void {
  mkdirSync(join(ctx.vault, "agent"), { recursive: true });
  writeFileSync(ctx.mcpConfigFile, `${JSON.stringify(mcpServerConfig(ctx), null, 2)}\n`);
}

export function launchContext(root: string, vault: string, options: { tier: Tier; agent: string; port: string }): LaunchContext {
  return {
    root,
    vault,
    tier: options.tier,
    agent: options.agent,
    viewUrl: `http://127.0.0.1:${options.port}`,
    mcpConfigFile: join(vault, "agent", "mcp.json"),
    skillFile: join(root, "plugin", "skills", "inner-graph", "SKILL.md"),
    pluginDir: join(root, "plugin"),
  };
}
