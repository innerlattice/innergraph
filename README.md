# Inner Graph

A local-first, versioned, typed graph of a person's inner landscape, built from their own
writing by AI agents: git for the psyche. Agents' changes land at once, and every change
can be undone. See
[SPEC.md](docs/SPEC.md) for the ubiquitous language and architecture, and
[context.md](docs/context.md) for the product principles.

Version <!-- version -->0.2.0<!-- /version -->. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

v1 scope: single device, offline, local model (Ollama), one user-defined Schema.

## Desktop app

Installers for macOS (Apple silicon and Intel, `.dmg`) and Windows (x64, `.exe`) are attached to
each [GitHub release](https://github.com/innerlattice/belief-graph/releases). The app keeps its
Vault (and the Vault's key, `vault.key`) in its own data folder, created on first run:
`~/Library/Application Support/Inner Graph/vault` on macOS, `%APPDATA%\Inner Graph\vault` on
Windows.

The installers are not signed yet, so each system warns the first time:

- **macOS** says the app "can't be opened" or is "damaged". Right-click the app in
  Applications and choose Open, or run `xattr -dr com.apple.quarantine "/Applications/Inner Graph.app"`.
- **Windows** SmartScreen says it "protected your PC". Choose More info → Run anyway.

### Connecting other agents

Settings (bottom left) → Connect other agents shows, for Claude Desktop, Claude Code, Codex
and Hermes Agent, the snippet that adds the map to that agent as an MCP server, with where it
goes. Each connects with the `write` tier under its own name, so its changes show (and undo) as
its own. The desktop app's snippet runs the app's own binary as Node
(`ELECTRON_RUN_AS_NODE=1`) on its bundled CLI; from source it runs `src/bin.ts` with tsx.

### Building the installers

```bash
npm run desktop   # run the desktop app from source
npm run dist      # installers for this platform → release/
```

`npm run dist` on a Mac builds both `.dmg`s (ad-hoc signed, so they run on Apple silicon).
Windows installers are built by the [Installers](.github/workflows/installers.yml) workflow,
which runs only when started by hand (Actions → Installers → Run workflow). Run it on a
version tag and it also drafts a GitHub release with the installers and that version's
changelog, ready to publish.

## Quick start

```bash
npm install
npm run build                       # the app → web/dist
npx tsx src/bin.ts init             # creates ~/.inner-graph/default with schema/author.yaml
npm start                           # the app on :4317
```

The app is chat-first. Write to the assistant in the middle column; it saves your message
as an Entry, adds what it finds to the map, and shows each change as a card with Undo. The
passages it used are highlighted in your message (click one to see it on the map). Select
items on the map and they appear above the message box, so "these" means something.
Conversations are in the left rail and the views (map, loops, entries, log) in the right
rail; both open on hover, and clicking the open view again gives the chat the whole
window. Settings (bottom left) choose the model: a ChatGPT plan (signed in with a code),
OpenRouter with a key (or `OPENROUTER_API_KEY`), or any local OpenAI-compatible server
(Ollama by default). A
conversation warns at 70% of its token budget and ends at 90%; the map keeps everything.

`inner-graph chat` instead boots an external agent harness wired to the Inner Graph MCP
server and skill, with the app alongside:

- `--harness claude` (default) runs Claude Code with the plugin in `plugin/` (the
  `inner-graph` skill) and the MCP server via `--mcp-config`.
- `--harness "<any command>"` runs another harness with `INNER_GRAPH_MCP_CONFIG` (an
  `mcpServers` JSON file written to `<vault>/agent/mcp.json`), `INNER_GRAPH_SKILL` (the
  skill's `SKILL.md`) and `INNER_GRAPH_VIEW` in its environment.
- Chat connections use the `write` tier; pass `--tier read` for a look-only agent.

The map updates live as any agent works. Select with click, shift-click or a drag
box; the agent sees the selection through `get_selection`. "History" lists recent
changes, each undoable as a whole; the side panel can confirm ("Looks right"), remove,
restore and rename (double-click the title).

Local models: interpretation uses Ollama at `http://127.0.0.1:11434` with `gemma4:latest`
(`INNER_GRAPH_MODEL`, `INNER_GRAPH_MODEL_URL`). Graph search embeds with
`qwen3-embedding:0.6b` (`INNER_GRAPH_EMBED_MODEL`, or `off`) and can rerank with the chat model
(`INNER_GRAPH_RERANK=llm` to enable; off by default because a general chat model is a slow,
coarse reranker). Missing models degrade to lexical search with a note. The embedder is
configurable; `qwen3-embedding:0.6b` was chosen as the default for its Apache-2.0 license and
official Ollama support (jina-embeddings-v5-text-small scores higher but is CC BY-NC).

### Other commands

```bash
npx tsx src/bin.ts serve                        # graph view only
npx tsx src/bin.ts add journal.md               # ingest a file with the local model
npx tsx src/bin.ts mcp --tier read|write --agent <name>
npx tsx src/bin.ts schema schema/author.yaml    # apply a newer Schema version to a Vault
```

### MCP tools

| Tier | Tools |
| --- | --- |
| read | `get_schema`, `get_node`, `get_entry`, `list_entries`, `search_graph`, `search_evidence`, `trace_roots`, `find_loops`, `find_related`, `graph_at`, `get_selection`, `recent_changes`, `find_duplicates` |
| write | `add_entry`, `add_to_graph`, `revise_entry`, `amend`, `remove`, `merge_nodes`, `split_node`, `merge_duplicates`, `restore`, `undo`, `undo_session`, `revert` |

Write tools are not registered on a read connection.

## Architecture

Layers follow SPEC.md; calls go down only, and every Client calls Managers.

| Layer | Code |
| --- | --- |
| Clients | `src/clients/` — HTTP API for the UI, MCP server, CLI; `web/` React + Tailwind UI |
| Managers | `src/managers/` — `IngestManager`, `MapManager`, `ExploreManager` |
| Engines | `src/engines/` — `InterpretationEngine`, `AnalysisEngine`, `RecallEngine` |
| Resource access | `src/access/` — `VaultAccess` (Log, blobs, Projection), `SchemaAccess`, `IngestAccess` |
| Resources | SQLCipher database (`better-sqlite3-multiple-ciphers`), Ollama |
| Utilities | `src/utilities/` — HLC, ULID/crypto, `ModelGateway`, `JobQueue`, graph algorithms |

Key decisions:

- **Log is canonical.** `events` is append-only; the `view_*` tables are a disposable
  cache of the materialized View, rewritten on every append. The Graph at any HLC is `fold(Log[≤T])`
  (`src/access/projection.ts`).
- **Every change is a Session.** Any Actor's graph Events apply as written; each Session
  (an ingest, a rename, a merge) can be undone as a whole. The person's own assertions are
  confirmed; agents' are unconfirmed until the person says "Looks right".
- **One View.** Every item is `active` (optionally `confirmed`) or `removed`; clients render
  the materialized View (`src/access/view.ts`) and "Show removed" only widens its filter.
- **Roles, not type names.** Engines read only `derivational`, `causal`, `identity` from the
  Schema. Theory vocabulary lives only in `schema/author.yaml`.
- **Evidence is verified.** Models cite verbatim quotes; `evidenceLocator` turns them into
  UTF-8 byte ranges and drops any quote not found in the Entry. Assertions left without
  Evidence are dropped (Invariant 2 is also enforced at the Log boundary).
- **Encryption.** The whole database is SQLCipher-encrypted. The key comes from
  `INNER_GRAPH_KEY` or `<vault>/vault.key` (created with mode 0600). Per-Event body
  encryption for sync is designed for, not built.
- **Concurrency.** The UI server and MCP server may share a Vault; appends take an
  immediate write lock and each process reloads the Log when another has appended.

## Experiments

`experiments/best-case/` holds Claude's own decomposition of the real fixtures and a script
that writes them into a fresh Vault through the MCP server:

```bash
npx tsx experiments/best-case/decompose.ts        # → .experiments/best-case
npx tsx src/bin.ts serve --vault .experiments/best-case --port 4318
```

`test/golden.test.ts` pins these down (e.g. entry 2 must yield the reinforcing
Hider → Dissociator → Controller loop), so interpretation pipelines can be compared
against them.

## Look up before writing

Every write path (local model, entry revisions, agents over MCP) resolves new items against
the graph before appending:

- The model is shown the existing Nodes related to the Entry (all of them up to 60, then
  per-sentence retrieval plus everything the Entry already supports).
- A proposed Node that cites the same passage as an existing Node of the same type, or has
  a near-identical label, is re-asserted instead of duplicated; a merely similar one is
  noted as `similarTo`.
- Edges are identified by (from, type, to); re-asserting one merges evidence.
- Existing duplicates can be found and cleaned up (`find_duplicates`, `merge_duplicates`, or
  "History" → Merge in the graph view).

## Undo

The Log is append-only, so undo is a compensating Event and can itself be undone:
`restore` brings back anything removed, `undo` reverses one Log Event (and the edges
attached to what it touched), `undo_session` reverses a whole change, and `revert` returns
the whole graph to any past point (with a preview). Removing in the graph view shows an Undo
bar; "Show removed" makes removed items selectable.

## Quality gate

```bash
npm run quality   # typecheck + tests with coverage + metrics
```

`scripts/metrics.ts` computes, for every function in `src/` and `web/src/`:

- **CRAP** = CC² × (1 − coverage)³ + CC, using McCabe complexity (branches, loops, cases,
  catches, `&&`/`||`/`??`) and istanbul statement coverage within the function.
- **Maintainability Index** per file = 171 − 5.2 ln(V) − 0.23 CC − 16.2 ln(SLOC) over the
  file's per-function averages (the escomplex convention; 171 scale, not the 0–100
  normalised variant). Declaration-only files have no functions and are listed, not scored.

The gate fails if median or mode CRAP exceeds 8 or any file's MI is 70 or below. The
report is written to `coverage/metrics.json`.

## Versions and shipping

Inner Graph follows [semver](https://semver.org): patch for fixes, minor for new features,
major for changes that break a Vault or an agent's use of the MCP tools. Every push is a
version:

```bash
npm run ship -- patch   # or minor, major
```

`scripts/ship.ts` checks the tree is clean and has commits since the last version, runs
`npm run quality` and both builds, bumps the version in `package.json`, adds the commits since
the last version to [CHANGELOG.md](CHANGELOG.md), stamps the version in this README, then
commits `Release vX.Y.Z`, tags it and pushes with the tag. It warns when the README, docs and
plugin haven't changed since the last version; check they still describe the app. The
`.githooks/pre-push` hook (installed by `npm install`) refuses a push whose commit isn't a
version; `git push --no-verify` skips it. Building installers for a version stays manual (see
[Building the installers](#building-the-installers)).

## Open questions carried from the spec

- Real journal Entries are still pending as fixtures; `test/fixtures/entry-1.md` is synthetic.
- Recall uses TF-IDF; embeddings (and whether to use sqlite-vec) are undecided.
- Sessions are inferred per Entry; explicit sessions are not built.
- Small local models may create near-duplicate Nodes; identical type+label is merged
  automatically, anything else is left to Merge in the UI.
