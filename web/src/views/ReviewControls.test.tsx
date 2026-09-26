// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyEvent, ItemChange, MapGraphView } from "../api";
import { ItemActions, KINDS_BY_STATUS, PendingChanges, ReviewActions, UndoBar, kindsFor } from "./ReviewControls";
import { ReviewPanel, queueSize, reviewQueue } from "./ReviewPanel";
import { StatusBar, toggle } from "./StatusBar";

const HLC = "001758800000000.000000.d";
const meta = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "agent:c", assertedAt: HLC, updatedAt: HLC, derivedFrom: [], staleEvidence: 0 };
const node = (id: string, status: string, held = false) => ({ ...meta, id, type: "part", label: id.toUpperCase(), status, held, proposedBy: held ? `ev-${id}` : undefined });
const change = (id: string, body: object): ItemChange => ({ event: { id, hlc: HLC, device: "d", actor: "model:g", session: "s", parents: [], type: "StatusChanged", body } as AnyEvent, reasons: ["status change proposed by an agent"] });

const view = {
  nodes: { a: node("a", "proposed", true), b: node("b", "proposed"), c: node("c", "approved") },
  edges: { e: { ...meta, id: "e", type: "reinforces", from: "b", to: "c", status: "proposed", held: false } },
  counts: { proposed: 3, approved: 1, parked: 0, declined: 2 },
  position: HLC,
  reasons: { a: ["new root-level node"] },
  changes: { c: [change("x", { target: "c", status: "superseded" })] },
} as unknown as MapGraphView;

let posted: { url: string; body: unknown }[];
beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return url.includes("decline") ? new Response('{"error":"nope"}', { status: 400 }) : new Response("[]");
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("actions by status", () => {
  it("maps each status to what it allows, one place for the whole app", () => {
    expect(KINDS_BY_STATUS).toEqual({ proposed: ["approve", "decline"], approved: ["decline"], parked: [], declined: ["restore"] });
    expect(kindsFor(["declined", "declined"])).toEqual(["restore"]);
    expect(kindsFor(["approved", "proposed"])).toEqual(["approve", "decline"]);
    expect(kindsFor(["approved", "declined"])).toEqual(["decline"]);
    const { container } = render(<ItemActions id="x" status="parked" onDone={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("runs actions and reports errors", async () => {
    const onDone = vi.fn();
    render(<ReviewActions ids={["a"]} kinds={["approve", "decline", "restore"]} labels={{ restore: "Bring back" }} onDone={onDone} />);
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: "approve", ids: ["a"] }));
    fireEvent.click(screen.getByText("Bring back"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: "restore", ids: ["a"] }));
    fireEvent.click(screen.getByText("Decline"));
    expect(await screen.findByText("nope")).toBeTruthy();
  });
});

describe("proposed changes on items", () => {
  it("lists each change with its reasons and reviews it by event id", async () => {
    render(<PendingChanges changes={[change("x", { target: "c", status: "superseded" })]} labels={{ c: "C" }} onDone={vi.fn()} />);
    expect(screen.getByText(/C → superseded/)).toBeTruthy();
    fireEvent.click(screen.getByText("Accept change"));
    await waitFor(() => expect(posted[0]).toEqual({ url: "/api/approve", body: { ids: ["x"] } }));
    cleanup();
    const { container } = render(<PendingChanges changes={[]} labels={{}} onDone={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("undo bar", () => {
  it("appears only after a decline", () => {
    const onUndo = vi.fn();
    const { rerender, container } = render(<UndoBar done={{ kind: "approve", ids: ["a"] }} onUndo={onUndo} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    rerender(<UndoBar done={{ kind: "decline", ids: ["a", "b"] }} onUndo={onUndo} onClose={vi.fn()} />);
    expect(screen.getByText("Declined 2 items.")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalled();
    rerender(<UndoBar done={{ kind: "decline", ids: ["a"] }} onUndo={onUndo} onClose={vi.fn()} />);
    expect(screen.getByText("Declined 1 item.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss"));
  });
});

describe("review queue", () => {
  it("groups what is waiting", () => {
    const q = reviewQueue(view, [{ kind: "edge", ids: ["e", "f"], reason: "same" }]);
    expect(q.held.map((i) => i.id)).toEqual(["a"]);
    expect(q.proposed.map((i) => i.id)).toEqual(["b", "e"]);
    expect(q.changes.map((c) => c.event.id)).toEqual(["x"]);
    expect(queueSize(q)).toBe(5);
    expect(queueSize(reviewQueue(undefined))).toBe(0);
  });

  it("explains each section, focuses items and merges duplicates", async () => {
    const onFocus = vi.fn();
    const onDone = vi.fn();
    render(<ReviewPanel view={view} duplicates={[{ kind: "node", ids: ["b", "c"], reason: "same" }]} labels={{ a: "A", b: "B", c: "C", e: "B → C" }} onFocus={onFocus} onDone={onDone} onClose={vi.fn()} />);
    expect(screen.getByText(/stay off the map until you approve them/)).toBeTruthy();
    expect(screen.getByText(/new root-level node/)).toBeTruthy();
    fireEvent.click(screen.getByText("A"));
    expect(onFocus).toHaveBeenCalledWith(["a"]);
    fireEvent.click(screen.getByText("“B” is recorded 2 times"));
    expect(onFocus).toHaveBeenCalledWith(["b", "c"]);
    fireEvent.click(screen.getByText("Merge into one"));
    await waitFor(() => expect(posted.at(-1)).toEqual({ url: "/api/duplicates/merge", body: { groups: [{ kind: "node", ids: ["b", "c"], reason: "same" }] } }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("says when nothing is waiting", () => {
    render(<ReviewPanel labels={{}} onFocus={vi.fn()} onDone={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Nothing is waiting for you.")).toBeTruthy();
  });
});

describe("status bar", () => {
  it("toggles statuses in a stable order and opens review", () => {
    expect(toggle(["approved"], "proposed")).toEqual(["proposed", "approved"]);
    expect(toggle(["proposed", "approved"], "proposed")).toEqual(["approved"]);
    const onFilter = vi.fn();
    const onReview = vi.fn();
    const { rerender } = render(<StatusBar counts={view.counts} filter={["proposed"]} onFilter={onFilter} toReview={4} onReview={onReview} />);
    fireEvent.click(screen.getByText("Review 4"));
    expect(onReview).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Declined"));
    expect(onFilter).toHaveBeenCalledWith(["proposed", "declined"]);
    rerender(<StatusBar filter={[]} onFilter={onFilter} toReview={0} onReview={onReview} />);
    expect(screen.getByText("Nothing to review")).toBeTruthy();
  });
});
