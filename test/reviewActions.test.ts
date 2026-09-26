import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphNode } from "../src/core/types.js";
import { ENTRY_1, INTERPRETATION_1, type TestVault, makeVault } from "./helpers.js";

let t: TestVault;

beforeEach(async () => {
  t = makeVault([INTERPRETATION_1]);
  t.vault.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
  await t.vault.queue.idle();
});
afterEach(() => t.cleanup());

function node(label: string): GraphNode {
  const found = Object.values(t.vault.explore.graph({ includeSuperseded: true }).nodes).find((n) => n.label === label);
  if (!found) throw new Error(label);
  return found;
}

function proposed(label: string) {
  const found = t.vault.ingest.pendingChanges().assertions.find((a) => "label" in a.item && a.item.label === label);
  if (!found) throw new Error(label);
  return found;
}

describe("pending changes", () => {
  it("lists proposed assertions with reasons, separately from other changes", () => {
    const pending = t.vault.ingest.pendingChanges();
    expect(pending.assertions.map((a) => a.kind).sort()).toEqual(["edge", "edge", "edge", "node"]);
    expect(proposed("Father laughed when I cried").reasons).toEqual(["new root-level node"]);
    expect(pending.other).toEqual([]);
  });
});

describe("approve", () => {
  it("merges a proposed node and marks it accepted", () => {
    const memory = proposed("Father laughed when I cried");
    const outcome = t.vault.ingest.approve([memory.item.id]);
    expect(outcome.merged).toEqual([memory.eventId]);
    expect(node("Father laughed when I cried").status).toBe("accepted");
  });

  it("brings pending endpoints along with an approved edge", () => {
    const edge = t.vault.ingest.pendingChanges().assertions.find((a) => a.kind === "edge" && "type" in a.item && a.item.type === "abduces");
    t.vault.ingest.approve([edge?.item.id as string]);
    expect(t.vault.explore.graph().edges[edge?.item.id as string].status).toBe("accepted");
    expect(node("Father laughed when I cried").status).toBe("hypothesis");
  });

  it("accepts merged hypotheses and records agent approvals as the agent's own reviewed changes", () => {
    const shame = node("Shame");
    t.vault.ingest.approve([shame.id], "agent:claude");
    expect(node("Shame").status).toBe("accepted");
    const last = t.vault.explore.timeline(1)[0];
    expect(last).toMatchObject({ type: "ProposalReviewed", actor: "agent:claude" });
  });

  it("never lets an agent approve a parked node, and reports unknown ids as skipped", () => {
    const shame = node("Shame");
    t.vault.map.setStatus(shame.id, "parked");
    const outcome = t.vault.ingest.approve([shame.id, "nope"], "agent:claude");
    expect(node("Shame").status).toBe("parked");
    expect(outcome.skipped).toEqual([shame.id, "nope"]);
    t.vault.ingest.approve([shame.id]);
    expect(node("Shame").status).toBe("accepted");
  });
});

describe("decline", () => {
  it("rejects a proposed node together with the edges that depend on it", () => {
    const memory = proposed("Father laughed when I cried");
    const outcome = t.vault.ingest.decline([memory.item.id]);
    expect(outcome.rejected).toHaveLength(2);
    expect(t.vault.ingest.pendingChanges().assertions).toHaveLength(2);
  });

  it("retires a merged hypothesis", () => {
    const rest = node("Rest");
    t.vault.ingest.decline([rest.id], "agent:claude");
    expect(node("Rest").status).toBe("superseded");
    expect(t.vault.explore.graph().nodes[rest.id]).toBeUndefined();
  });
});

describe("selection of proposed items", () => {
  it("describes proposed nodes and edges in the shared selection", () => {
    const memory = proposed("Father laughed when I cried");
    const selection = t.vault.explore.setSelection([memory.item.id, node("Shame").id]);
    expect(selection.items.map((i) => [i.label, i.status])).toEqual([
      ["Father laughed when I cried", "proposed"],
      ["Shame", "proposed"],
    ]);
  });
});
