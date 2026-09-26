// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Graph, PendingItem } from "../api";
import { ProposedPanel, ReviewActions, ReviewBar, hypothesisIds } from "./ReviewControls";

const meta = { attributes: {}, confidence: 0.4, assertedBy: "agent:claude", assertedAt: "", updatedAt: "" };
const nodeItem: PendingItem = {
  eventId: "e1",
  session: "s",
  kind: "node",
  reasons: ["new root-level node"],
  item: { ...meta, id: "p1", type: "core_memory", label: "Episode", status: "hypothesis", derivedFrom: [], evidence: [{ entry: "h", start: 0, end: 5 }] },
};
const edgeItem: PendingItem = {
  eventId: "e2",
  session: "s",
  kind: "edge",
  reasons: [],
  item: { ...meta, id: "p2", type: "reinforces", from: "a", to: "zz", status: "hypothesis", evidence: [] },
};
const graph = {
  nodes: { a: { ...meta, id: "a", type: "t", label: "A", status: "hypothesis", derivedFrom: [], evidence: [] } },
  edges: { x: { ...meta, id: "x", type: "t", from: "a", to: "a", status: "accepted", evidence: [] } },
} as unknown as Graph;

let posted: { url: string; body: unknown }[];
beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return url.includes("decline") ? new Response('{"error":"nope"}', { status: 400 }) : new Response("{}");
    }
    return new Response(JSON.stringify({ entry: {}, text: "Hello world", citations: [] }));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("review bar", () => {
  it("counts proposed items and hypotheses and selects them", () => {
    expect(hypothesisIds(graph)).toEqual(["a"]);
    expect(hypothesisIds(undefined)).toEqual([]);
    const onSelect = vi.fn();
    render(<ReviewBar proposed={[nodeItem]} graph={graph} onSelect={onSelect} />);
    expect(screen.getByText("1 proposed · 0 with proposed changes · 1 hypotheses to confirm")).toBeTruthy();
    fireEvent.click(screen.getByText("Select proposed"));
    fireEvent.click(screen.getByText("Select hypotheses"));
    expect(onSelect.mock.calls).toEqual([[["p1"]], [["a"]]]);
  });

  it("hides when there is nothing to review", () => {
    const { container } = render(<ReviewBar proposed={[]} onSelect={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("review actions", () => {
  it("approves and reports decline errors", async () => {
    const onDone = vi.fn();
    render(<ReviewActions ids={["p1", "a"]} onDone={onDone} approveLabel="Approve 2" />);
    fireEvent.click(screen.getByText("Approve 2"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Decline"));
    expect(await screen.findByText("nope")).toBeTruthy();
    expect(posted.map((p) => p.body)).toEqual([{ ids: ["p1", "a"] }, { ids: ["p1", "a"] }]);
  });
});

describe("proposed panel", () => {
  it("shows a proposed node with reasons and its evidence", async () => {
    render(<ProposedPanel item={nodeItem} labels={{}} onDone={vi.fn()} />);
    expect(screen.getByText("Episode")).toBeTruthy();
    expect(screen.getByText(/new root-level node/)).toBeTruthy();
    expect(await screen.findByText("“Hello”")).toBeTruthy();
  });

  it("names a proposed edge by its endpoints", () => {
    render(<ProposedPanel item={edgeItem} labels={{ a: "A" }} onDone={vi.fn()} />);
    expect(screen.getByText("A —reinforces→ zz")).toBeTruthy();
  });
});

describe("duplicates notice", async () => {
  const { DuplicatesNotice } = await import("./ReviewControls");
  it("selects duplicates and cleans them up", async () => {
    const onSelect = vi.fn();
    const onCleaned = vi.fn();
    render(<DuplicatesNotice groups={[{ kind: "edge", ids: ["a", "b"], reason: "same" }]} onSelect={onSelect} onCleaned={onCleaned} />);
    fireEvent.click(screen.getByText("1 duplicate group"));
    expect(onSelect).toHaveBeenCalledWith(["a", "b"]);
    fireEvent.click(screen.getByText("Clean up"));
    await waitFor(() => expect(onCleaned).toHaveBeenCalled());
  });

  it("reports failures and hides when there are none", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"busy"}', { status: 400 }));
    const { rerender } = render(<DuplicatesNotice groups={[{ kind: "node", ids: ["a"], reason: "x" }, { kind: "node", ids: ["b"], reason: "y" }]} onSelect={vi.fn()} onCleaned={vi.fn()} />);
    fireEvent.click(screen.getByText("Clean up"));
    expect(await screen.findByText("busy")).toBeTruthy();
    expect(screen.getByText("2 duplicate groups")).toBeTruthy();
    rerender(<DuplicatesNotice groups={[]} onSelect={vi.fn()} onCleaned={vi.fn()} />);
    expect(screen.queryByText("Clean up")).toBeNull();
  });
});
