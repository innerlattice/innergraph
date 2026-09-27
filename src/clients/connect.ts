// How other agents reach the map: the command that runs its MCP server, and each agent's own way
// of being told about it. The command is this same program asked to speak MCP: the source through
// tsx in development, the desktop app's own binary (running as plain Node) once installed.
import { join } from "node:path";
import YAML from "yaml";
import type { Tier } from "./mcp.js";

/** How to start this program: `prefix` comes before the command-line arguments. */
export interface Runner {
  command: string;
  prefix: string[];
  env?: Record<string, string>;
}

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function mcpLaunch(runner: Runner, vault: string, tier: Tier, agent: string): McpLaunch {
  return { command: runner.command, args: [...runner.prefix, "mcp", "--vault", vault, "--tier", tier, "--agent", agent], env: runner.env ?? {} };
}

/** The server as most agents' JSON config names one: its environment only when it has one. */
export function serverEntry(launch: McpLaunch) {
  const { command, args, env } = launch;
  return Object.keys(env).length > 0 ? { command, args, env } : { command, args };
}

export const SERVER_NAME = "inner-graph";

export type Platform = "darwin" | "win32" | "linux";

export interface AgentSetup {
  id: string;
  name: string;
  /** Where the snippet goes, or what to do with it. */
  how: string;
  language: "json" | "toml" | "yaml" | "shell";
  snippet: string;
}

/** Quotes a shell word when it needs it, such as a path with spaces in it. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(word) ? word : `"${word.replace(/(["\\$`])/g, "\\$1")}"`;
}

const CLAUDE_DESKTOP_CONFIG: Record<Platform, string> = {
  darwin: "~/Library/Application Support/Claude/claude_desktop_config.json",
  win32: "%APPDATA%\\Claude\\claude_desktop_config.json",
  linux: "~/.config/Claude/claude_desktop_config.json",
};

const home = (platform: Platform, path: string) => (platform === "win32" ? `%USERPROFILE%\\${path.replace(/\//g, "\\")}` : `~/${path}`);

function claudeDesktop(launch: McpLaunch, platform: Platform): AgentSetup {
  return {
    id: "claude-desktop",
    name: "Claude Desktop",
    how: `Add this to ${CLAUDE_DESKTOP_CONFIG[platform]} (merge it into any "mcpServers" already there), then restart Claude Desktop.`,
    language: "json",
    snippet: JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry(launch) } }, null, 2),
  };
}

function claudeCode(launch: McpLaunch): AgentSetup {
  const env = Object.entries(launch.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
  const words = ["claude", "mcp", "add", "--scope", "user", SERVER_NAME, ...env, "--", launch.command, ...launch.args];
  return {
    id: "claude-code",
    name: "Claude Code",
    how: "Run this in a terminal. It adds the map to Claude Code in every project.",
    language: "shell",
    snippet: words.map(shellWord).join(" "),
  };
}

function codex(launch: McpLaunch, platform: Platform): AgentSetup {
  const lines = [`[mcp_servers.${SERVER_NAME}]`, `command = ${JSON.stringify(launch.command)}`, `args = ${JSON.stringify(launch.args)}`];
  const env = Object.entries(launch.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  if (env.length > 0) lines.push(`env = { ${env.join(", ")} }`);
  return { id: "codex", name: "Codex", how: `Add this to ${home(platform, ".codex/config.toml")}, then start a new Codex session.`, language: "toml", snippet: lines.join("\n") };
}

function hermes(launch: McpLaunch, platform: Platform): AgentSetup {
  return {
    id: "hermes",
    name: "Hermes Agent",
    how: `Add this to ${home(platform, ".hermes/config.yaml")} (merge it into any "mcp_servers" already there), then restart Hermes.`,
    language: "yaml",
    snippet: YAML.stringify({ mcp_servers: { [SERVER_NAME]: serverEntry(launch) } }).trimEnd(),
  };
}

/** Each agent's setup, every one connecting with write access under its own name. */
export function agentSetups(runner: Runner, vault: string, platform: Platform): AgentSetup[] {
  const as = (agent: string) => mcpLaunch(runner, vault, "write", agent);
  return [claudeDesktop(as("claude-desktop"), platform), claudeCode(as("claude-code")), codex(as("codex"), platform), hermes(as("hermes"), platform)];
}

/** The installed desktop app: its own binary run as plain Node on the bundled CLI. */
export function desktopRunner(execPath: string, root: string): Runner {
  return { command: execPath, prefix: [join(root, "build", "cli.mjs")], env: { ELECTRON_RUN_AS_NODE: "1" } };
}
