# Changelog

Every version of Inner Graph, newest first. `npm run ship` writes each section from the commits
since the version before it.

## 0.4.5 — 2026-10-23

- The README names what each pronoun means and uses serial commas throughout

## 0.4.4 — 2026-10-23

- New tagline: a map of your inner life, automatically built from your writing; the README's quotes are typographic

## 0.4.3 — 2026-10-23

- The README shows the app in screenshots, with badges, highlights, a note on care and answers to common questions

## 0.4.2 — 2026-10-21

- Patch shell-quote, vitest and MCP SDK advisories

## 0.4.1 — 2026-10-14

- Search always uses the built-in model; the Ollama embedding option is gone (INNER_GRAPH_EMBED=off still turns it off)

## 0.4.0 — 2026-10-13

- Search understands meaning out of the box, in many languages, with a model that comes with the app instead of needing Ollama

## 0.3.8 — 2026-10-13

- The assistant shares a crisis line and keeps talking when someone mentions self-harm, and never presents itself as a therapist

## 0.3.7 — 2026-10-11

- Links point to the repository's new home, github.com/innerlattice/innergraph

## 0.3.6 — 2026-10-02

- Reloading after an update loads the new app instead of crashing: the browser rechecks index.html every time and keeps only the hashed bundles

## 0.3.5 — 2026-10-01

- Removing and confirming are separate: restoring an item keeps its confirmation, and history shows when one is unconfirmed

## 0.3.4 — 2026-10-01

- Maps made by an earlier version get their node shapes back: the app brings a Vault up to the Schema it ships with when it starts

## 0.3.3 — 2026-09-30

- The README is for people using the app; running from source, architecture and MCP details have their own pages

## 0.3.2 — 2026-09-30

- Building installers for a version publishes its release when the builds finish

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
