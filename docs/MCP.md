# Connecting agents over MCP

Any agent that speaks [MCP](https://modelcontextprotocol.io) can work on a Vault. The server is
this same program asked to speak MCP over stdio:

```bash
inner-graph mcp --vault <dir> --tier read|write --agent <name>
```

- `--tier read` registers only the read tools; `write` (what the app's snippets use) adds the
  ones that change the graph. Write tools are not registered on a read connection.
- `--agent` names the Actor its changes are recorded under (`agent:<name>`), so they show, and
  undo, as that agent's.

## Setting an agent up

In the app, Settings → Connect other agents gives the snippet for Claude Desktop, Claude Code,
Codex and Hermes Agent, with where it goes (`src/clients/connect.ts` writes them). The installed
desktop app's snippet runs the app's own binary as plain Node (`ELECTRON_RUN_AS_NODE=1`) on its
bundled CLI, so nothing else needs installing; from source it runs `src/bin.ts` with tsx.

| Agent | Where the snippet goes |
| --- | --- |
| Claude Desktop | `claude_desktop_config.json`, under `mcpServers` |
| Claude Code | a `claude mcp add --scope user` command |
| Codex | `~/.codex/config.toml`, a `[mcp_servers.inner-graph]` table |
| Hermes Agent | `~/.hermes/config.yaml`, under `mcp_servers` |

## The skill

The server sends [`skill/SKILL.md`](../skill/SKILL.md) as its MCP instructions when an agent
connects: how to decompose writing, resolve what the person refers to, change the graph and
talk about loops. It is the same guidance the in-app assistant follows, so a connected agent
needs no other setup. Agents that load skills from files can also install it as a skill, for
example at `~/.claude/skills/inner-graph/SKILL.md`.

## Tools

| Tier | Tools |
| --- | --- |
| read | `get_schema`, `get_node`, `get_entry`, `list_entries`, `search_graph`, `search_evidence`, `trace_roots`, `find_loops`, `find_related`, `graph_at`, `get_selection`, `recent_changes`, `find_duplicates` |
| write | `add_entry`, `add_to_graph`, `revise_entry`, `amend`, `remove`, `merge_nodes`, `split_node`, `merge_duplicates`, `restore`, `undo`, `undo_session`, `revert` |

The map in the app updates live as an agent works, and the agent sees what the person has
selected there through `get_selection`.

Vault content returned by these tools is read by the connected agent's model; if that model is
hosted, it leaves the device.
