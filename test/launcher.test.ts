import { describe, expect, it } from "vitest";
import { HARNESSES, claudeCommand, customPlan, launchContext, mcpServerConfig, planFor } from "../src/clients/launcher.js";

const ctx = launchContext("/repo", "/vault", { tier: "write", agent: "claude", port: "4317" });

describe("launcher", () => {
  it("describes the MCP server for the vault and tier", () => {
    expect(mcpServerConfig(ctx).mcpServers["inner-graph"]).toEqual({
      command: "/repo/node_modules/.bin/tsx",
      args: ["/repo/src/bin.ts", "mcp", "--vault", "/vault", "--tier", "write", "--agent", "claude"],
    });
    expect(ctx).toMatchObject({ viewUrl: "http://127.0.0.1:4317", mcpConfigFile: "/vault/agent/mcp.json", pluginDir: "/repo/plugin" });
  });

  it("boots Claude Code with the plugin skill, the MCP config and the view URL", () => {
    const plan = HARNESSES.claude(ctx);
    expect(plan.args[0]).toBe("--plugin-dir");
    expect(plan.args[1]).toBe("/repo/plugin");
    expect(JSON.parse(plan.args[3])).toEqual(mcpServerConfig(ctx));
    expect(plan.args[5]).toContain("http://127.0.0.1:4317");
    expect(plan.env.INNER_GRAPH_SKILL).toBe("/repo/plugin/skills/inner-graph/SKILL.md");
  });

  it("runs any other harness as a command with paths in the environment", () => {
    expect(customPlan("codex  --x", ctx)).toMatchObject({ command: "codex", args: ["--x"], env: { INNER_GRAPH_MCP_CONFIG: "/vault/agent/mcp.json" } });
    expect(planFor("claude", ctx).env.INNER_GRAPH_VAULT).toBe("/vault");
    expect(planFor("aider", ctx).command).toBe("aider");
  });

  it("finds the claude binary even when it is only a shell alias", () => {
    expect(claudeCommand({ INNER_GRAPH_CLAUDE: "/x/claude" })).toBe("/x/claude");
    expect(claudeCommand({})).toMatch(/claude$/);
  });
});
