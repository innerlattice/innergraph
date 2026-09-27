import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { agentSetups, mcpLaunch, serverEntry } from "../src/clients/connect.js";
import { findRoot } from "../src/paths.js";

const desktop = { command: "/Applications/Inner Graph.app/Contents/MacOS/Inner Graph", prefix: ["/app/build/cli.mjs"], env: { ELECTRON_RUN_AS_NODE: "1" } };
const source = { command: "/repo/node_modules/.bin/tsx", prefix: ["/repo/src/bin.ts"] };
const VAULT = "/Users/me/Library/Application Support/Inner Graph/vault";

const setup = (runner: typeof source, id: string, platform: "darwin" | "win32" = "darwin") => {
  const found = agentSetups(runner, VAULT, platform).find((a) => a.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("connecting other agents", () => {
  it("runs the MCP server with write access under the agent's name", () => {
    expect(mcpLaunch(source, VAULT, "write", "codex")).toEqual({
      command: source.command,
      args: ["/repo/src/bin.ts", "mcp", "--vault", VAULT, "--tier", "write", "--agent", "codex"],
      env: {},
    });
  });

  it("leaves the environment out of a config entry when there is none", () => {
    expect(serverEntry(mcpLaunch(source, VAULT, "read", "x"))).not.toHaveProperty("env");
    expect(serverEntry(mcpLaunch(desktop, VAULT, "read", "x")).env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("offers Claude Desktop, Claude Code, Codex and Hermes Agent", () => {
    expect(agentSetups(source, VAULT, "darwin").map((a) => a.id)).toEqual(["claude-desktop", "claude-code", "codex", "hermes"]);
  });

  it("gives Claude Desktop JSON for its config file on each platform", () => {
    const mac = setup(desktop, "claude-desktop");
    expect(JSON.parse(mac.snippet).mcpServers["inner-graph"].args).toContain("claude-desktop");
    expect(mac.how).toContain("Library/Application Support/Claude");
    expect(setup(desktop, "claude-desktop", "win32").how).toContain("%APPDATA%");
  });

  it("gives Claude Code a command with paths quoted", () => {
    const { snippet } = setup(desktop, "claude-code");
    expect(snippet).toContain("claude mcp add --scope user inner-graph --env ELECTRON_RUN_AS_NODE=1 --");
    expect(snippet).toContain(`"${desktop.command}"`);
    expect(snippet).toContain(`"${VAULT}"`);
  });

  it("gives Codex a TOML table", () => {
    const { snippet } = setup(desktop, "codex");
    expect(snippet.split("\n")).toEqual([
      "[mcp_servers.inner-graph]",
      `command = ${JSON.stringify(desktop.command)}`,
      `args = ${JSON.stringify([...desktop.prefix, "mcp", "--vault", VAULT, "--tier", "write", "--agent", "codex"])}`,
      'env = { ELECTRON_RUN_AS_NODE = "1" }',
    ]);
    expect(setup(source, "codex").snippet).not.toContain("env");
    expect(setup(source, "codex", "win32").how).toContain("%USERPROFILE%\\.codex\\config.toml");
  });

  it("gives Hermes Agent YAML under mcp_servers", () => {
    const parsed = YAML.parse(setup(desktop, "hermes").snippet);
    expect(parsed.mcp_servers["inner-graph"]).toEqual({ ...serverEntry(mcpLaunch(desktop, VAULT, "write", "hermes")) });
  });
});

describe("finding the app's own files", () => {
  it("walks up to the folder holding package.json", () => {
    const has = (p: string) => p === "/a/b/package.json";
    expect(findRoot("/a/b/c/d", has)).toBe("/a/b");
    expect(findRoot("/x/y", () => false)).toBe("/x/y");
  });
});
