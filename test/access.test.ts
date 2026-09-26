import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/access/database.js";
import { normalise } from "../src/access/ingestAccess.js";
import { InvariantError, checkDraft } from "../src/access/invariants.js";
import { applyEvent, emptyState, fold, mergeEvidence, patchAttributes } from "../src/access/projection.js";
import {
  SchemaAccess,
  SchemaError,
  checkEdge,
  checkNode,
  derivationalNodeTypes,
  loadSchemaFile,
  parseSchema,
  rolesOf,
} from "../src/access/schemaAccess.js";
import { VaultAccess } from "../src/access/vaultAccess.js";
import type { AnyEvent } from "../src/core/types.js";
import { KEY, SCHEMA_FILE, steppingClock, tempDir } from "./helpers.js";

function makeEvent(partial: Partial<AnyEvent> & Pick<AnyEvent, "type" | "body">, hlc: string): AnyEvent {
  return { id: `e${hlc}`, hlc, device: "d", actor: "user", session: "s", parents: [], ...partial } as AnyEvent;
}

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "NodeAsserted" as const,
  body: { id, type: "t", label: id, attributes: {}, confidence: 0.5, evidence: [{ entry: "h", start: 0, end: 1 }], ...extra },
});

describe("projection fold", () => {
  it("applies user events directly and holds agent events until reviewed", () => {
    const events = [
      makeEvent(node("a"), "01"),
      makeEvent({ ...node("b"), actor: "agent:x", session: "p" }, "02"),
      makeEvent({ type: "ProposalReviewed", body: { session: "p", accepted: ["e02"], rejected: [] } }, "03"),
    ];
    expect(Object.keys(fold(events, "02").graph.nodes)).toEqual(["a"]);
    const state = fold(events);
    expect(Object.keys(state.graph.nodes)).toEqual(["a", "b"]);
    expect(state.graph.nodes.a.status).toBe("accepted");
    expect(state.graph.nodes.b.status).toBe("hypothesis");
    expect(state.proposals.p.events[0].decision).toBe("accepted");
    expect(state.position).toBe("03");
  });

  it("re-asserting a Node merges Evidence and ignores type conflicts", () => {
    const state = fold([
      makeEvent(node("a", { attributes: { x: 1 } }), "01"),
      makeEvent(node("a", { attributes: { y: 2 }, confidence: 0.9, evidence: [{ entry: "h", start: 5, end: 9 }] }), "02"),
      makeEvent(node("a", { type: "other", confidence: 0.1 }), "03"),
    ]);
    expect(state.graph.nodes.a.attributes).toEqual({ x: 1, y: 2 });
    expect(state.graph.nodes.a.confidence).toBe(0.9);
    expect(state.graph.nodes.a.evidence).toHaveLength(2);
  });

  it("asserts Edges only between existing Nodes and re-asserts them", () => {
    const edge = (id: string, to: string) => ({
      type: "EdgeAsserted" as const,
      body: { id, type: "r", from: "a", to, attributes: {}, confidence: 0.5, evidence: [] },
    });
    const state = fold([makeEvent(node("a"), "01"), makeEvent(edge("e1", "a"), "02"), makeEvent(edge("e2", "zz"), "03"), makeEvent(edge("e1", "a"), "04")]);
    expect(Object.keys(state.graph.edges)).toEqual(["e1"]);
    expect(state.graph.edges.e1.updatedAt).toBe("04");
  });

  it("patches attributes, labels, confidence and status", () => {
    const state = fold([
      makeEvent(node("a", { attributes: { x: 1, y: 2 } }), "01"),
      makeEvent({ type: "AttributesChanged", body: { target: "a", patch: { x: null, z: 3 }, label: "A", confidence: 0.2 } }, "02"),
      makeEvent({ type: "AttributesChanged", body: { target: "missing", patch: {} } }, "03"),
      makeEvent({ type: "StatusChanged", body: { target: "a", status: "parked" } }, "04"),
      makeEvent({ type: "StatusChanged", body: { target: "missing", status: "parked" } }, "05"),
    ]);
    expect(state.graph.nodes.a).toMatchObject({ attributes: { y: 2, z: 3 }, label: "A", confidence: 0.2, status: "parked" });
  });

  it("migrates types on SchemaChanged and tracks entries and sessions", () => {
    const schema = { name: "s", version: 2, nodeTypes: {}, edgeTypes: {} };
    const state = fold([
      makeEvent({ type: "SessionOpened", body: { purpose: "ingest", entry: "h" } }, "01"),
      makeEvent({ type: "EntryAdded", body: { entry: "h", source: "text", title: "T", bytes: 3 } }, "02"),
      makeEvent(node("a"), "03"),
      makeEvent({ type: "SchemaChanged", body: { schema, migration: { nodeTypes: { t: "u" }, edgeTypes: {} } } }, "04"),
      makeEvent({ type: "SessionClosed", body: {} }, "05"),
      makeEvent({ type: "SessionClosed", body: {}, session: "orphan" }, "06"),
      makeEvent({ type: "ProposalReviewed", body: { session: "unknown", accepted: [], rejected: [] } }, "07"),
    ]);
    expect(state.graph.nodes.a.type).toBe("u");
    expect(state.schema).toEqual(schema);
    expect(state.entries.h).toMatchObject({ title: "T", session: "s" });
    expect(state.proposals.s.closed).toBe(true);
    expect(state.proposals.orphan.purpose).toBe("unspecified");
  });

  it("ignores refactors of unknown Nodes", () => {
    const state = emptyState();
    applyEvent(state, makeEvent({ type: "NodesSplit", body: { source: "x", into: [] } }, "01"));
    applyEvent(state, makeEvent({ type: "NodesMerged", body: { sources: ["x"], into: { id: "y", label: "y", type: "t", attributes: {} } } }, "02"));
    expect(state.graph.nodes).toEqual({});
  });

  it("helpers merge evidence and patch attributes", () => {
    const e = { entry: "h", start: 0, end: 1 };
    expect(mergeEvidence([e], [e, { ...e, end: 2 }])).toHaveLength(2);
    expect(patchAttributes({ a: 1 }, { a: null, b: 2 })).toEqual({ b: 2 });
  });
});

describe("invariants", () => {
  const draft = (actor: string, evidence: unknown[], confidence = 0.5, session = "s") =>
    ({ actor, session, type: "NodeAsserted", body: { id: "n", type: "t", label: "l", attributes: {}, confidence, evidence } }) as never;

  it("requires Evidence for agent assertions only", () => {
    expect(() => checkDraft(draft("agent:x", []))).toThrow(InvariantError);
    expect(() => checkDraft(draft("user", []))).not.toThrow();
  });

  it("requires confidence in range and a session", () => {
    expect(() => checkDraft(draft("user", [], 1.5))).toThrow("confidence");
    expect(() => checkDraft(draft("user", [], 0.5, ""))).toThrow("session");
    expect(() => checkDraft({ actor: "user", session: "s", type: "SessionClosed", body: {} })).not.toThrow();
  });
});

describe("SchemaAccess", () => {
  const schema = loadSchemaFile(SCHEMA_FILE);

  it("loads the seed Schema and exposes Roles", () => {
    expect(schema.name).toBe("author");
    expect(rolesOf(schema)).toMatchObject({ abduces: "derivational", reinforces: "causal", aspect_of: "identity", triggers: undefined });
    expect(rolesOf(null)).toEqual({});
    expect(derivationalNodeTypes(schema)).toEqual(new Set(["core_memory", "belief", "relational_prediction"]));
  });

  it("validates Nodes and Edges against the Schema", () => {
    expect(checkNode(schema, "belief", { depth: "core" })).toEqual([]);
    expect(checkNode(schema, "belief", { nope: 1 })).toHaveLength(1);
    expect(checkNode(schema, "nope", {})).toHaveLength(1);
    expect(checkEdge(schema, "abduces", "core_memory", "belief")).toEqual([]);
    expect(checkEdge(schema, "abduces", "belief", "core_memory")).toHaveLength(2);
    expect(checkEdge(schema, "reinforces", "event", "belief")).toEqual([]);
    expect(checkEdge(schema, "nope", "a", "b")).toHaveLength(1);
  });

  it("reads label styles and display hints", () => {
    expect(schema.nodeTypes.part).toMatchObject({ label: "name", display: { shape: "ellipse" } });
    expect(() => parseSchema("name: x\nversion: 1\nnodeTypes: {a: {display: {shape: blob}}}\nedgeTypes: {}")).toThrow(SchemaError);
  });

  it("rejects malformed Schemas", () => {
    expect(() => parseSchema("name: x")).toThrow(SchemaError);
    expect(() => parseSchema("name: x\nversion: 1\nnodeTypes: {a: {}}\nedgeTypes: {e: {from: [b], to: [a]}}")).toThrow("unknown node types: b");
    const star = parseSchema("name: x\nversion: 1\nnodeTypes: {a: {}}\nedgeTypes: {e: {role: derivational}}");
    expect(derivationalNodeTypes(star)).toEqual(new Set(["a"]));
  });

  it("reads the current Schema from the Log", () => {
    const dir = tempDir();
    const db = openDatabase(join(dir, "v.db"), KEY);
    const access = new SchemaAccess(db);
    expect(access.current()).toBeNull();
    expect(() => access.require()).toThrow();
    const vault = new VaultAccess(db);
    vault.append([{ actor: "user", session: "s", type: "SchemaChanged", body: { schema, migration: { nodeTypes: {}, edgeTypes: {} } } }]);
    expect(access.require().name).toBe("author");
    db.close();
    rmSync(dir, { recursive: true });
  });
});

describe("IngestAccess", () => {
  it("normalises text, markdown and chat exports", () => {
    expect(normalise({ content: "  hello\nworld " })).toMatchObject({ text: "hello\nworld", title: "hello", source: "text" });
    expect(normalise({ content: "---\na: 1\n---\n# Title\nbody", format: "markdown" })).toMatchObject({ title: "Title", media: "text/markdown" });
    const chat = normalise({ content: JSON.stringify([{ role: "user", content: "hi" }, {}]), format: "chat-json", title: "Chat" });
    expect(chat.text).toBe("user: hi\n\nunknown:");
    expect(chat.title).toBe("Chat");
  });

  it("rejects empty and malformed input", () => {
    expect(() => normalise({ content: "   " })).toThrow("empty");
    expect(() => normalise({ content: "{}", format: "chat-json" })).toThrow("array");
  });
});

describe("VaultAccess", () => {
  it("persists an encrypted Log that reopens only with the right key", () => {
    const dir = tempDir();
    const file = join(dir, "v.db");
    const db = openDatabase(file, KEY);
    const vault = new VaultAccess(db, steppingClock());
    const hash = vault.putBlob(new TextEncoder().encode("héllo world"), "text/plain");
    const [first, second] = vault.append([
      { actor: "user", session: "s", type: "SessionOpened", body: { purpose: "x" } },
      { actor: "user", session: "s", type: "NodeAsserted", body: { id: "n", type: "t", label: "l", attributes: {}, confidence: 1, evidence: [{ entry: hash, start: 0, end: 6 }] } },
    ]);
    expect(second.parents).toEqual([first.id]);
    expect(vault.readSpan({ entry: hash, start: 0, end: 6 })).toBe("héllo");
    expect(vault.readSpan({ entry: "missing", start: 0, end: 1 })).toBe("");
    expect(vault.readText("missing")).toBe("");
    expect(vault.events(first.hlc)).toHaveLength(1);
    expect(Object.keys(vault.stateAt(first.hlc).graph.nodes)).toHaveLength(0);
    expect(db.prepare("SELECT count(*) AS c FROM evidence").get()).toEqual({ c: 1 });
    db.close();

    const reopened = new VaultAccess(openDatabase(file, KEY));
    const other = new VaultAccess(openDatabase(file, KEY));
    other.append([{ actor: "user", session: "s2", type: "SessionClosed", body: {} }]);
    expect(reopened.events()).toHaveLength(3);
    const [next] = reopened.append([{ actor: "user", session: "s3", type: "SessionClosed", body: {} }]);
    expect(next.parents).toEqual([other.events()[2].id]);
    expect(next.hlc > other.events()[2].hlc).toBe(true);
    expect(reopened.device).toBe(vault.device);
    expect(reopened.state().graph.nodes.n.label).toBe("l");
    expect(() => openDatabase(file, "b".repeat(64))).toThrow();
    expect(() => openDatabase(file, "short")).toThrow("64 hex");
    rmSync(dir, { recursive: true });
  });
});
