# Inner Graph

A local-first, versioned, typed graph of a person's inner landscape, built from their own
writing by AI agents and reviewed at session boundaries: git for the psyche. See
[SPEC.md](docs/SPEC.md) for the ubiquitous language and architecture, and
[context.md](docs/context.md) for the product principles.

v1 scope: single device, offline, local model (Ollama), one user-defined Schema.

## Quick start

```bash
npm install
npm run build                       # graph view → web/dist
npx tsx src/bin.ts init             # creates ~/.inner-graph/default with schema/author.yaml
npm run chat                        # graph view on :4317 + your agent harness
```

`inner-graph` (or `inner-graph chat`) is the main interface. It serves the graph view and
boots an agent harness wired to the Inner Graph MCP server and skill:

- `--harness claude` (default) runs Claude Code with the plugin in `plugin/` (the
  `inner-graph` skill) and the MCP server via `--mcp-config`.
- `--harness "<any command>"` runs another harness with `INNER_GRAPH_MCP_CONFIG` (an
  `mcpServers` JSON file written to `<vault>/agent/mcp.json`), `INNER_GRAPH_SKILL` (the
  skill's `SKILL.md`) and `INNER_GRAPH_VIEW` in its environment.
- Chat connections use the `commit` tier so "approve the selected ones" works; pass
  `--tier propose` to require approvals in the graph view.

The graph view updates live as the agent works: proposed items appear as amber ghosts,
merged hypotheses as pale nodes. Select with click, shift-click or a drag box; the agent
sees the selection through `get_selection`. Approve or decline in the side panel, or ask the
agent to.

Local models: interpretation uses Ollama at `http://127.0.0.1:11434` with `gemma4:latest`
(`INNER_GRAPH_MODEL`, `INNER_GRAPH_MODEL_URL`). Graph search embeds with
`qwen3-embedding:0.6b` (`INNER_GRAPH_EMBED_MODEL`, or `off`) and reranks with the chat model
(`INNER_GRAPH_RERANK=off` to disable). Missing models degrade to lexical search with a note.

### Other commands

```bash
npx tsx src/bin.ts serve                        # graph view only
npx tsx src/bin.ts add journal.md               # ingest a file with the local model
npx tsx src/bin.ts mcp --tier read|propose|commit --agent <name>
npx tsx src/bin.ts schema schema/author.yaml    # apply a newer Schema version to a Vault
```

### MCP tools

| Tier | Tools |
| --- | --- |
| read | `get_schema`, `get_node`, `get_entry`, `list_entries`, `search_graph`, `search_evidence`, `trace_roots`, `find_loops`, `find_related`, `graph_at`, `get_selection`, `list_proposals`, `find_duplicates` |
| propose | `add_entry`, `propose`, `revise_entry`, `amend`, `merge_duplicates` |
| commit | `approve`, `decline`, `review`, `restore`, `undo`, `revert` |

Tools above a connection's tier are not registered at all.

## Architecture

Layers follow SPEC.md; calls go down only, and every Client calls Managers.

| Layer | Code |
| --- | --- |
| Clients | `src/clients/` — HTTP API for the UI, MCP server, CLI; `web/` React + Tailwind UI |
| Managers | `src/managers/` — `IngestManager`, `MapManager`, `ExploreManager` |
| Engines | `src/engines/` — `InterpretationEngine`, `ReviewEngine`, `AnalysisEngine`, `RecallEngine` |
| Resource access | `src/access/` — `VaultAccess` (Log, blobs, Projection), `SchemaAccess`, `IngestAccess` |
| Resources | SQLCipher database (`better-sqlite3-multiple-ciphers`), Ollama |
| Utilities | `src/utilities/` — HLC, ULID/crypto, `ModelGateway`, `JobQueue`, graph algorithms |

Key decisions:

- **Log is canonical.** `events` is append-only; `nodes`, `edges`, `evidence` tables are a
  disposable cache rewritten on every append. The Graph at any HLC is `fold(Log[≤T])`
  (`src/access/projection.ts`).
- **Proposals are branches.** Graph events from any Actor other than `user` stay pending in
  their Session until a `ProposalReviewed` event merges them. The `ReviewEngine`
  auto-merges low-impact events; new root-level Nodes, new causal loops, Refactors and
  agent status changes wait for review. Rejecting a Node rejects its dependent Edges.
- **Roles, not type names.** Engines read only `derivational`, `causal`, `identity` from the
  Schema. Theory vocabulary lives only in `schema/author.yaml`.
- **Evidence is verified.** Models cite verbatim quotes; `evidenceLocator` turns them into
  UTF-8 byte ranges and drops any quote not found in the Entry. Assertions left without
  Evidence are dropped (Invariant 2 is also enforced at the Log boundary).
- **Park.** Parked Nodes are excluded from Recall and from the interpretation context; no
  Actor other than `user` can un-park.
- **Encryption.** The whole database is SQLCipher-encrypted. The key comes from
  `INNER_GRAPH_KEY` or `<vault>/vault.key` (created with mode 0600). Per-Event body
  encryption for sync is designed for, not built.
- **Concurrency.** The UI server and MCP server may share a Vault; appends take an
  immediate write lock and each process reloads the Log when another has appended.

Review policy is configurable per Vault in `<vault>/config.json`:

```json
{ "review": { "autoAccept": true, "minAutoConfidence": 0.4 } }
```

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

Every write path (local model, entry revisions, agents over MCP) resolves proposals against
the graph before appending:

- The model is shown the existing Nodes related to the Entry (all of them up to 60, then
  per-sentence retrieval plus everything the Entry already supports).
- A proposed Node that cites the same passage as an existing Node of the same type, or has
  a near-identical label, is re-asserted instead of duplicated; a merely similar one is held
  for review as "may duplicate X".
- Edges are identified by (from, type, to); re-asserting one merges evidence.
- Existing duplicates can be found and cleaned up (`find_duplicates`, `merge_duplicates`, or
  "Clean up" in the graph view).

## Undo

The Log is append-only, so undo is a compensating Event and can itself be undone:
`restore` brings back anything declined, `undo` reverses one Log Event (and the edges
attached to what it touched), and `revert` returns the whole graph to any past point
(with a preview). Declining in the graph view shows an Undo bar; "Show declined" makes
retired items selectable.

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

## Open questions carried from the spec

- Real journal Entries are still pending as fixtures; `test/fixtures/entry-1.md` is synthetic.
- Recall uses TF-IDF; embeddings (and whether to use sqlite-vec) are undecided.
- Sessions are inferred per Entry; explicit sessions are not built.
- Small local models may create near-duplicate Nodes; identical type+label is merged
  automatically, anything else is left to Merge in the UI.
