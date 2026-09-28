# Changelog

Every version of Inner Graph, newest first. `npm run ship` writes each section from the commits
since the version before it.

## 0.3.1 — 2026-09-28

- A version's tag lists what changed in it, as the changelog does

## 0.3.0 — 2026-09-28

- Agents connect over MCP and get the skill as its instructions; the chat command that launched a harness is gone

## 0.2.0 — 2026-09-27

- Every push ships as a version: npm run ship bumps semver, writes the changelog and tags, and installers build on demand in CI
- A desktop app for macOS and Windows, built into unsigned installers with npm run dist
- Settings shows how to connect Claude Desktop, Claude Code, Codex and Hermes Agent to the map

## 0.1.0 — 2026-09-27

- The first version: a local, encrypted, versioned map of a person's inner landscape, built from
  their writing by a chat assistant or any agent over MCP, with the map, loops, entries and log
  views, time travel and undo for every change.
