# Architecture

A local-first, versioned, typed graph of a person's inner landscape, built from their own
writing by AI agents: git for the psyche. [SPEC.md](SPEC.md) is the source of truth for the
ubiquitous language and the core model, and [context.md](context.md) for the architecture rules
and product principles. This page says where those live in the code.

v1 scope: single device, offline-capable, one user-defined Schema.

## Layers

Layers follow SPEC.md; calls go down only, and every Client calls Managers.

| Layer | Code |
| --- | --- |
| Clients | `src/clients/` — HTTP API for the UI, MCP server, CLI; `web/` React + Tailwind UI; `desktop/` the Electron shell |
| Managers | `src/managers/` — `IngestManager`, `MapManager`, `ExploreManager`, `ChatManager` |
| Engines | `src/engines/` — `InterpretationEngine`, `AnalysisEngine`, `RecallEngine` |
| Resource access | `src/access/` — `VaultAccess` (Log, blobs, Projection), `SchemaAccess`, `IngestAccess` |
| Resources | SQLCipher database (`better-sqlite3-multiple-ciphers`), model providers |
| Utilities | `src/utilities/` — HLC, ULID/crypto, `ModelGateway`, `JobQueue`, graph algorithms |

## Key decisions

- **Log is canonical.** `events` is append-only; the `view_*` tables are a disposable
  cache of the materialized View, rewritten on every append. The Graph at any HLC is `fold(Log[≤T])`
  (`src/access/projection.ts`).
- **Every change is a Session.** Any Actor's graph Events apply as written; each Session
  (an ingest, a rename, a merge) can be undone as a whole. The person's own assertions are
  confirmed; agents' are unconfirmed until the person says "Looks right".
- **One View.** Every item carries two independent flags, `removed` and `confirmed`; clients
  render the materialized View (`src/access/view.ts`) and "Show removed" only widens it.
- **Roles, not type names.** Engines read only `derivational`, `causal`, `identity` from the
  Schema. Theory vocabulary lives only in `schema/author.yaml`.
- **Evidence is verified.** Models cite verbatim quotes; `evidenceLocator` turns them into
  UTF-8 byte ranges and drops any quote not found in the Entry. Assertions left without
  Evidence are dropped (Invariant 2 is also enforced at the Log boundary).
- **Encryption.** The whole database is SQLCipher-encrypted. The key comes from
  `INNER_GRAPH_KEY` or `<vault>/vault.key` (created with mode 0600). Per-Event body
  encryption for sync is designed for, not built.
- **Concurrency.** The UI server and MCP servers may share a Vault; appends take an
  immediate write lock and each process reloads the Log when another has appended.

## One server, three ways in

`src/clients/server.ts` starts the local server (the HTTP API plus the built web app on
127.0.0.1). The CLI's `serve` runs it from source; the desktop app (`desktop/main.ts`) runs the
same server in an Electron window, with its Vault in the app's data folder. Other agents reach
the Vault through the MCP server ([MCP.md](MCP.md)), a separate process on the same files.
`src/paths.ts` finds the app's own files (schema, skill, web app) from wherever the code runs,
source or bundle.

## The assistant

The in-app conversation (`src/clients/chat.ts`) uses the same tools as MCP
(`src/clients/tools.ts`) and the same instructions (`skill/SKILL.md`). Its model is chosen in
Settings: a ChatGPT plan (device-code sign-in; tokens kept only in the encrypted Vault),
OpenRouter, or a local OpenAI-compatible server. A conversation warns at 70% of its token
budget and ends at 90%.

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

## Search and local models

Interpretation from the CLI uses Ollama at `http://127.0.0.1:11434` with `gemma4:latest`
(`INNER_GRAPH_MODEL`, `INNER_GRAPH_MODEL_URL`). Graph search embeds with
`qwen3-embedding:0.6b` (`INNER_GRAPH_EMBED_MODEL`, or `off`) and can rerank with the chat model
(`INNER_GRAPH_RERANK=llm` to enable; off by default because a general chat model is a slow,
coarse reranker). Missing models degrade to lexical search with a note. The embedder is
configurable; `qwen3-embedding:0.6b` was chosen as the default for its Apache-2.0 license and
official Ollama support (jina-embeddings-v5-text-small scores higher but is CC BY-NC).

## Open questions carried from the spec

- Real journal Entries are still pending as fixtures; `test/fixtures/entry-1.md` is synthetic.
- Recall uses TF-IDF; embeddings (and whether to use sqlite-vec) are undecided.
- Sessions are inferred per Entry; explicit sessions are not built.
- Small local models may create near-duplicate Nodes; identical type+label is merged
  automatically, anything else is left to Merge in the UI.
