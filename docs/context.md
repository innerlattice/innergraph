# Inner Graph — project context for Claude

Read `SPEC.md` first. It is the source of truth for the ubiquitous language, core model,
volatility decomposition and layered architecture. Use its terms exactly (Vault, Entry,
Event, Log, Node, Edge, Evidence, Schema, Role, Session, Proposal, Review, Actor, Refactor,
Projection). Do not introduce synonyms.

## What this is
Local-first "git for the psyche": an append-only, encrypted event log of a person's inner
landscape (beliefs, memories, parts, loops), interpreted from their own writing by AI
agents, projected into a typed graph, and exposed to any agent over MCP. Goal: an
open-source tool others can use, so the core must stay theory-agnostic.

## Architecture rules (IDesign / volatility-based decomposition)
- Decompose by volatility, never by function. Each volatility lives in exactly one component.
- Layers: Clients → Managers → Engines → ResourceAccess → Resources; Utilities cross-cut.
- Calls go down only. Managers never call Managers (queue instead). Engines are stateless.
- Every Client, including the MCP server, calls Managers — never storage directly.
- Core code reads Roles (`derivational`, `causal`, `identity`), never Schema type names.
- No theory vocabulary (IFS, CPM, "part", "core belief") in core code. It belongs in Schema files.
- Prefer existing CS primitives (event sourcing, HLC, ULID, content-addressed blobs,
  version vectors, SQLCipher) over custom machinery. Avoid bloat in the core model.

## Product principles
- Chat first: the person writes and talks, the agent changes the map, and every change
  lands at once and can be undone. Editing the map by hand is a secondary escape hatch,
  added only where talking proves frustrating.
- Every agent assertion carries Evidence and Confidence. Hypotheses stay labeled
  unconfirmed until the person confirms them. The map acts as a prior on the user's self-understanding,
  so unsupported claims must never look settled.
- Nothing is destroyed; corrections and Refactors are new Events with lineage.
- Recall and suggestions are offered, never pushed. No scores, streaks, grades or
  "you still haven't done X" messaging. Removed items never come back through Recall.
  The tool must feel safe to a user's protective, cautious side.
- Scope discipline: v1 = single device, offline, local model, ingestion + graph.
  Sync, hosting, mobile, Activities are designed-for only. Push back on scope creep.

## Author's theory (seed Schema, not core)
Core memories → (irrational abduction) → core beliefs → derived belief graph → constrains
cognitive appraisals (component process model) and perception. Durable change via memory
reconsolidation (reactivation + mismatch + rehearsal) cascading down the belief tree.
Suffering persists via causal feedback loops (network psychopathology / active inference).
Mapped to Roles: abduces/scaffolds = derivational; reinforces (+/-) = causal.

## Status / next steps
1. Author provides 3–5 real journal Entries as fixtures (pending).
2. Draft `schema/author.yaml` from the theory above; test against fixtures.
3. Walk each core use case in SPEC.md through the components before writing code.
4. Choose language/stack; build VaultAccess (event log + projection) first, then
   IngestManager + InterpretationEngine against a local model, then the MCP server.
5. Resolve open questions listed at the end of SPEC.md.
