# Inner Graph — Core Spec (v0.1)

Sep 25, 2026, by @Aya Hohner

## Purpose and scope

Inner Graph (working name) is a local-first, versioned, typed graph of a person's inner landscape, built from their own writing by AI agents, mostly through conversation. Think "local git for the psyche": an append-only event log, a graph projection, and an agent interface (MCP).

v1 covers ingestion and the graph only: single device, offline, local model, one user-defined Schema. Activities, exercises, sync and hosting are designed for but not built.

Design rules: the core is theory-agnostic (no IFS or CPM terms in code); agents write and changes land at once; the person steers by talking, confirming, removing and undoing (manual editing is a secondary escape hatch); nothing is ever destroyed, only removed (and can be restored).

## Ubiquitous language

These terms are used identically in code, API, UI and conversation. Theory terms (part, core belief, appraisal) never appear in the core; they live only in a Schema.

| Term | Definition | CS primitive |
| --- | --- | --- |
| Vault | One person's complete store: log, blobs, schema, keys | Repository |
| Entry | Raw input: journal, transcript, reflection. Immutable | Content-addressed blob |
| Event | Atomic, immutable fact about a change, with actor and time | Append-only log record |
| Log | Ordered set of all Events in a Vault; the source of truth | Event store |
| Node | Typed entity in the graph (e.g. a belief, a memory) | Vertex |
| Edge | Typed, directed relation between two Nodes | Labeled directed edge |
| Evidence | Link from a Node or Edge to a span of an Entry | Pointer + byte range |
| Graph | Current Nodes and Edges, derived from the Log | Materialized view |
| Schema | Versioned definition of Node types, Edge types, attributes and roles | Type registry |
| Role | Structural meaning an Edge type declares (`derivational`, `causal`, `identity`) | Interface / trait |
| Session | Bounded unit of work producing a set of Events | Branch |
| Session | One bounded change by one Actor (an ingest, a rename, a merge); undoable as a whole | Commit |
| Actor | Who emitted an Event: user, agent, model | Author |
| Refactor | Split, merge, retype or rename Nodes with lineage preserved | Structural commit |
| Projection | Any read model derived from the Log (graph, loops, timeline) | Fold over events |
| Snapshot | Cached Projection at a Log position | Checkpoint |
| Confidence | Actor's certainty in a Node or Edge, 0–1 | Edge/vertex weight |
| Removed / Confirmed | Two independent flags on every Node and Edge: `removed` takes it off the map (restorable); `confirmed` means the person has said it looks right. The person's own items start confirmed | Boolean state |

## Core model

The core is an event-sourced typed property graph. The Log is canonical; everything else is a Projection that can be rebuilt by replay.

**Event envelope.** Every Event has the same shape; only `type` and `body` vary.

```
Event {
  id:       ULID
  hlc:      HybridLogicalClock   // total order across devices
  device:   DeviceId
  actor:    ActorId              // user | agent:<name> | model:<name>
  session:  SessionId
  parents:  [EventId]            // causal deps, as in a commit DAG
  type:     EventType
  body:     bytes                // encrypted at rest
}
```

**Event types (closed set, v1).**

- `EntryAdded`: stores a blob hash and metadata.
- `NodeAsserted` / `EdgeAsserted`: create with type, attributes, confidence, evidence.
- `AttributesChanged`: patch on a Node or Edge.
- `Marked`: sets `removed` and/or `confirmed` on a Node or Edge (remove, restore, confirm, undo).
- `NodesSplit` / `NodesMerged`: Refactor with lineage and evidence reassignment.
- `SchemaChanged`: new Schema version with a migration map.
- `SessionOpened` / `SessionClosed`: workflow boundaries.

**Invariants.**

1. Events are immutable. Correction is a new Event, never an edit.
2. Every Node and Edge asserted by an agent carries at least one Evidence pointer.
3. The Graph at any HLC position T is `fold(Log[≤T])`. Time travel is a bounded replay.
4. Node and Edge ids are stable across Refactors; lineage is a `derived_from` relation, not a rename.
5. Core code reads only Roles, never Schema type names.

**Schema roles.** A Schema maps its Edge types onto a small fixed set of Roles, so engines stay theory-agnostic:

- `derivational`: A produces B (e.g. memory → belief, belief → belief). Enables root-tracing and depth.
- `causal`: A increases or decreases B, with a sign. Enables loop detection.
- `identity`: A is an aspect or instance of B. Enables grouping and Refactor.

**Storage.** One SQLite file per Vault, encrypted with SQLCipher. Tables: `events`, `blobs`, and derived `nodes`, `edges`, `evidence`. Derived tables are disposable caches.

**Sync (designed, not built).** Delta exchange of Events past each peer's version vector. The relay stores per-Event ciphertext only. Merge is a set union ordered by HLC; conflicting attribute patches resolve last-writer-wins per field.

## Volatility decomposition

Each volatility is encapsulated by exactly one component. Axes: **T** = same user over time; **U** = across users at the same time.

| Volatility | Axis | Encapsulated by | Examples of change |
| --- | --- | --- | --- |
| Theory / ontology | T, U | Schema (data) + SchemaAccess | IFS, CPM synthesis, schema therapy |
| Interpretation | T, U | InterpretationEngine | Local vs hosted model, prompts, extraction strategy |
| Input source | U | IngestAccess adapters | Typed journal, voice transcript, chat export |
| Analysis | T | AnalysisEngine | Root tracing, loop detection, recurrence, later EWS |
| Similarity | T | RecallEngine | Embeddings model, matching threshold |
| Presentation | U | Clients | Network, causal loop, timeline; desktop vs phone |
| Storage / sync | U | VaultAccess + SyncUtility | Local only, own drive, hosted relay |
| Agent access | T, U | MCP Client + tiers | Read, write |
| Activities | T, U | ActivityManager (v2+) | Exercises, reconsolidation protocols |

**Nature of the business (not volatile, not encapsulated):** evidence goes in, is interpreted into a typed graph with provenance, and the graph evolves with full history. If a proposed change touches this, it is a new product, not a new component.

## Layered architecture

Calls flow downward only. Managers never call Managers directly; they queue work. Every Client, including the MCP server, calls Managers, never storage.

| Layer | Components | Responsibility |
| --- | --- | --- |
| Clients | Desktop UI, MCP server, CLI; later mobile, SaaS chat | Presentation and agent access only |
| Managers (workflow) | IngestManager, MapManager, ExploreManager | Orchestrate use cases; own Session lifecycle |
| Engines (activity) | InterpretationEngine, AnalysisEngine, RecallEngine | Pure business activities; stateless |
| Resource access | VaultAccess, SchemaAccess, IngestAccess | Atomic verbs over the Log, blobs and Schema |
| Resources | SQLCipher DB, blob store, local model runtime | Storage and inference |
| Utilities | Crypto, HLC, SyncUtility, ModelGateway, Logging | Cross-cutting |

**Managers.**

- IngestManager: Entry in → Session → InterpretationEngine → resolved against the graph → written; undoable as one Session.
- MapManager: Refactors, Schema migrations, confirm/remove/restore, undo, revert, time travel.
- ExploreManager: queries and Projections (root tracing, loops, recurrence, subgraphs for Activities).

**MCP surface (v1).** `add_entry`, `get_schema`, `search_evidence`, `get_node`, `trace_roots`, `find_loops`, `find_related`, `graph_at(t)`, `add_to_graph`, `amend`, `remove`, `merge_nodes`, `split_node`, `recent_changes`, `undo_session`, `revert` (write tools tier-gated). Each connection gets a tier: `read` or `write`. A one-line notice shows when a connection routes vault content to a hosted model.

## Core use cases

These validate the architecture: each must be expressible as a Manager workflow over existing Engines and Access components. Fixtures: the user's Schema plus 3–5 real Entries (pending).

1. **Ingest.** User adds an Entry → agent opens a Session, asserts Nodes and Edges with Evidence and Confidence → resolved against existing Nodes → lands at once, unconfirmed → the person confirms, corrects or undoes it in conversation or in the graph view.
2. **Recall.** On ingest, RecallEngine matches the Entry against existing Nodes and past Entries → returns related, possibly forgotten material with Evidence. Offered, never pushed.
3. **Trace roots.** Given any Node, follow `derivational` Edges upstream → rank candidate roots by how much of the downstream graph they support.
4. **Find loops.** Detect cycles over `causal` Edges → classify reinforcing vs balancing by sign product → return as a subgraph.
5. **Refactor.** Agent or user splits or merges → InterpretationEngine reassigns Evidence → lineage preserved.
6. **Time travel.** Render any Projection at a past HLC position; diff two positions.
7. **Undo.** Any Session (an ingest, a refactor) can be undone as a whole; removed items stay in history and can be restored; revert returns the graph to any past point.

## Out of scope for v1 and open questions

**Deferred:** multi-device sync, hosted relay, mobile client, Activities, stock-and-flow simulation, early-warning-signal time series, multi-user sharing.

**Open questions:**

- [ ] Is a fixed set of three Roles sufficient, or does the user's theory need a fourth (e.g. `constraining` for belief → appraisal)?
- [ ] Should Sessions be explicit (user opens and closes) or inferred (per Entry, or per time window)?
- [ ] Embeddings for Recall: local model choice and whether vectors live in the same SQLite file (e.g. sqlite-vec).
- [ ] Schema migration: can `SchemaChanged` always be expressed as a type-to-type map, or do some migrations need agent reinterpretation?
