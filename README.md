# Inner Graph

A local-first, versioned, typed graph of a person's inner landscape, built from their own
writing by AI agents and reviewed at session boundaries: git for the psyche. See
[SPEC.md](docs/SPEC.md) for the ubiquitous language and architecture, and
[context.md](docs/context.md) for the product principles.

v1 scope: single device, offline, local model (Ollama), one user-defined Schema.

## Quick start

```bash
npm install
npm run build                       # web UI → web/dist
npx tsx src/bin.ts init             # creates ~/.inner-graph/default with schema/author.yaml
npm start                           # http://127.0.0.1:4317
```

Interpretation uses Ollama at `http://127.0.0.1:11434` with `gemma4:latest` by default.
Override with `INNER_GRAPH_MODEL`, `INNER_GRAPH_MODEL_URL`, and the vault location with
`--vault <dir>` or `INNER_GRAPH_VAULT`. If the model URL is not local, the UI shows a
one-line notice that entry text leaves the device.

For UI development, run `npm run dev` (API on 4317, Vite on 5173 with a proxy).

### CLI

```bash
npx tsx src/bin.ts add journal.md               # ingest a file (.md, .json chat export, or text)
npx tsx src/bin.ts add note.txt --no-interpret  # store without interpretation
npx tsx src/bin.ts mcp --tier read|propose|commit --agent <name>
```

### MCP

Any agent can operate the Vault through the MCP server (stdio). Example client config:

```json
{
  "mcpServers": {
    "inner-graph": {
      "command": "npx",
      "args": ["tsx", "/path/to/belief-graph/src/bin.ts", "mcp", "--tier", "propose", "--agent", "claude"]
    }
  }
}
```

Tools: `get_schema`, `get_node`, `search_evidence`, `trace_roots`, `find_loops`,
`find_related`, `graph_at`, `list_proposals` (read); `add_entry`, `propose` (propose);
`review` (commit). Tools above the connection's tier are not registered at all.

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
