import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attributeRollback } from "../src/managers/revert.js";
import { ENTRY_1, INTERPRETATION_1, type TestVault, makeVault } from "./helpers.js";

let t: TestVault;
const graph = () => t.vault.explore.graph({ includeSuperseded: true });
const byLabel = (label: string) => Object.values(graph().nodes).find((n) => n.label === label && n.status !== "superseded") ?? Object.values(graph().nodes).find((n) => n.label === label);
const edgeBetween = (a: string, b: string) => Object.values(graph().edges).find((e) => e.from === byLabel(a)?.id && e.to === byLabel(b)?.id);
const lastEvent = () => t.vault.explore.timeline(1)[0];

beforeEach(async () => {
  t = makeVault([INTERPRETATION_1]);
  t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
  await t.vault.queue.idle();
});
afterEach(() => t.cleanup());

describe("restore", () => {
  it("brings back an edge that was confirmed and then removed by accident", () => {
    const edge = edgeBetween("Rest", "Shame")?.id as string;
    t.vault.map.confirm([edge]);
    t.vault.map.remove([edge]);
    expect(t.vault.explore.graph().edges[edge]).toBeUndefined();
    t.vault.map.restore(edge);
    expect(graph().edges[edge].status).toBe("accepted");
  });

  it("explains when there is nothing to restore", () => {
    expect(() => t.vault.map.restore("nope")).toThrow("not found");
    expect(() => t.vault.map.restore(byLabel("Shame")?.id as string)).toThrow("not removed");
  });
});

describe("undo", () => {
  it("undoes a label change", () => {
    const shame = byLabel("Shame")?.id as string;
    t.vault.map.changeAttributes(shame, { label: "Shame spiral", patch: { note: "x" } });
    t.vault.map.undo(t.vault.explore.timeline(3).find((e) => e.type === "AttributesChanged")?.id as string);
    expect(graph().nodes[shame]).toMatchObject({ label: "Shame", attributes: {} });
  });

  it("undoes a split, re-creating edges on the original node", async () => {
    const shame = byLabel("Shame")?.id as string;
    const attached = (id: string) => Object.values(t.vault.explore.graph().edges).filter((e) => e.from === id || e.to === id);
    const before = attached(shame).map((e) => `${e.from}|${e.type}|${e.to}`);
    expect(before.length).toBeGreaterThan(0);
    t.gateway.generateJson = async () => ({ parts: [{ evidence: [0], edges: [0, 1, 2] }, { evidence: [], edges: [] }] });
    await t.vault.map.split(shame, [{ label: "A" }, { label: "B" }]);
    const split = t.vault.explore.timeline(5).find((e) => e.type === "NodesSplit")?.id as string;
    const result = t.vault.map.undo(split);
    expect(result.summary.retired).toBeGreaterThan(0);
    expect(graph().nodes[shame].status).toBe("hypothesis");
    expect(byLabel("A")?.status).toBe("superseded");
    expect(attached(shame).map((e) => `${e.from}|${e.type}|${e.to}`)).toEqual(before);
  });

  it("rejects unknown events", () => {
    expect(() => t.vault.map.undo("nope")).toThrow("not found");
  });
});

describe("revert", () => {
  it("previews and returns the whole graph to an earlier point", () => {
    const position = lastEvent().hlc;
    const shame = byLabel("Shame")?.id as string;
    t.vault.map.confirm([shame]);
    t.vault.map.changeAttributes(shame, { label: "Changed" });
    const entry = t.vault.explore.entries()[0].id;
    t.vault.ingest.propose("agent:x", entry, { nodes: [{ ref: "m", type: "core_memory", label: "Manager meeting", confidence: 1, quotes: ["my manager asked a question"] }], edges: [] });
    expect(t.vault.map.revertPreview(position)).toEqual({ retired: 1, restored: 1, changed: 1 });
    t.vault.map.revert(position, "agent:claude");
    expect(graph().nodes[shame]).toMatchObject({ label: "Shame", status: "hypothesis" });
    expect(byLabel("Manager meeting")?.status).toBe("superseded");
    expect(lastEvent()).toMatchObject({ type: "SessionClosed", actor: "agent:claude" });
  });

  it("retires items created after the point and can itself be undone", () => {
    const position = lastEvent().hlc;
    const entry = t.vault.explore.entries()[0].id;
    t.vault.ingest.propose("user", entry, { nodes: [{ ref: "n", type: "event", label: "Later thing", confidence: 1, quotes: ["my manager asked a question"] }], edges: [] });
    const { session } = t.vault.map.revert(position);
    expect(byLabel("Later thing")?.status).toBe("superseded");
    const revertEvent = t.vault.explore.timeline(50).find((e) => e.session === session && e.type === "StatusChanged")?.id as string;
    t.vault.map.undo(revertEvent);
    expect(byLabel("Later thing")?.status).toBe("accepted");
  });
});

describe("attribute rollback", () => {
  it("restores changed keys and removes added ones", () => {
    expect(attributeRollback({ a: 1, b: 2 }, { a: 5, b: 2, c: 3 })).toEqual({ a: 1, c: null });
  });
});
