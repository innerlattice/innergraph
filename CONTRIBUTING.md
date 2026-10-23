# Contributing

How to run Inner Graph from source, check your work and ship it. How it is built is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the vocabulary to use is in
[docs/SPEC.md](docs/SPEC.md). Agents working in this repo also follow [AGENTS.md](AGENTS.md).

## Running from source

```bash
npm install
npm run build                       # the web app → web/dist
npm run models                      # the built-in embedding model → models/ (about 135 MB)
npx tsx src/bin.ts init             # creates ~/.inner-graph/default with schema/author.yaml
npm start                           # the app on http://127.0.0.1:4317
```

`npm run dev` runs the server and the web app with reloading. `npm run desktop` runs the
desktop app from source; it uses the desktop app's own Vault, not `~/.inner-graph/default`.

### Commands

```bash
npx tsx src/bin.ts serve                        # the app (the default command)
npx tsx src/bin.ts add journal.md               # ingest a file with the local model
npx tsx src/bin.ts mcp --tier read|write --agent <name>
npx tsx src/bin.ts schema schema/author.yaml    # apply a newer Schema version to a Vault
```

Every command takes `--vault <dir>` (or `INNER_GRAPH_VAULT`); `serve` takes `--port`.

### Environment

| Variable | What it sets |
| --- | --- |
| `INNER_GRAPH_VAULT` | the Vault folder (default `~/.inner-graph/default`) |
| `INNER_GRAPH_KEY` | the Vault's key, instead of `<vault>/vault.key` |
| `INNER_GRAPH_MODEL`, `INNER_GRAPH_MODEL_URL` | the local model and its server (Ollama by default) |
| `INNER_GRAPH_EMBED` | `off` to search without the built-in embedding model |
| `INNER_GRAPH_RERANK` | `llm` to rerank search with the chat model |
| `OPENROUTER_API_KEY` | an OpenRouter key, instead of one saved in Settings |

## Quality gate

```bash
npm run quality   # typecheck, lint, unused code, styles audit, tests with coverage, metrics
```

Run it before every commit that changes code. Besides the compiler, Biome
(`npm run format` fixes formatting), knip and the styles audit (every style comes from the
design tokens, see [docs/DESIGN.md](docs/DESIGN.md)), `scripts/metrics.ts` computes, for every
function in `src/` and `web/src/`:

- **CRAP** = CC² × (1 − coverage)³ + CC, using McCabe complexity (branches, loops, cases,
  catches, `&&`/`||`/`??`) and istanbul statement coverage within the function.
- **Maintainability Index** per file = 171 − 5.2 ln(V) − 0.23 CC − 16.2 ln(SLOC) over the
  file's per-function averages (the escomplex convention; 171 scale, not the 0–100
  normalised variant). Declaration-only files have no functions and are listed, not scored.

The gate fails if median or mode CRAP exceeds 8 or any file's MI is 70 or below. The
report is written to `coverage/metrics.json`.

For a refactor meant to change no behaviour, prove it: `npm run fingerprint -- --save` before
and `npm run fingerprint -- --check` after. The fingerprint hashes the bundled server and web
app with local names normalised, so it only moves when behaviour-bearing code does.

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

## Versions and shipping

Inner Graph follows [semver](https://semver.org): patch for fixes, minor for new features,
major for changes that break a Vault or an agent's use of the MCP tools. Every push is a
version:

```bash
npm run ship -- patch   # or minor, major
```

`scripts/ship.ts` checks the tree is clean and has commits since the last version, runs
`npm run quality` and both builds, bumps the version in `package.json`, adds the commits since
the last version to [CHANGELOG.md](CHANGELOG.md) (so write commit subjects as the change a
person would notice), stamps the version in the README, then commits `Release vX.Y.Z`, tags it
(the tag's message lists the same changes) and pushes with the tag. It warns when the README,
docs and skill haven't changed since the last version; check they still describe the app. The
`.githooks/pre-push` hook (installed by `npm install`) refuses a push to any branch whose
commit isn't a version, however the push names it (`HEAD:main` included); `git push --no-verify` skips it.

## Building installers

```bash
npm run dist      # installers for this platform → release/
```

`npm run dist` on a Mac builds both `.dmg`s (ad-hoc signed, so they run on Apple silicon;
nothing is signed with a developer identity yet). Configuration is in `electron-builder.yml`;
the app is packed without asar so other agents can run its bundled CLI.

Releases are cut by hand: the [Installers](.github/workflows/installers.yml) workflow runs only
when started (Actions → Installers → Run workflow). Run on a version tag, it builds the macOS
and Windows installers and publishes a GitHub release with them and that version's changelog.
Run on a branch, it only uploads the installers as build artifacts.
