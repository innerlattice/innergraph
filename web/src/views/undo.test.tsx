// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyEvent } from "../api";
import { EdgePanel } from "./EdgePanel";
import { LogView, undoable } from "./LogView";
import { ItemActions, UndoBar } from "./ReviewControls";
import { RevertControl, TimeBar, describeRevert } from "./TimeBar";

const HLC = "001758800000000.000000.d";
const base = { attributes: {}, confidence: 0.8, evidence: [], assertedBy: "agent:c", assertedAt: HLC, updatedAt: HLC, held: false, staleEvidence: 0 };
const change = (id: string, body: object, type = "StatusChanged") => ({ event: { id, hlc: HLC, device: "d", actor: "model:g", session: "s", parents: [], type, body } as AnyEvent, reasons: ["status change proposed by an agent"] });
const edgeView = {
  edge: { ...base, id: "e1", type: "reinforces", from: "a", to: "b", sign: 1 as number | undefined, status: "declined", staleEvidence: 2 },
  fromLabel: "A",
  toLabel: "B",
  evidence: [{ entry: "h", start: 0, end: 5, text: "quote", entryTitle: "T", before: "", after: "" }],
  reasons: [] as string[],
  changes: [change("p", { target: "e1", status: "approved" })],
};

let posted: { url: string; body: unknown }[];
beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return url.includes("/undo") && JSON.parse(String(init.body)).eventId === "bad"
        ? new Response('{"error":"cannot"}', { status: 400 })
        : new Response(JSON.stringify({ session: "s", summary: { retired: 1, restored: 0, changed: 2, declined: 0 } }));
    }
    if (url.startsWith("/api/edges")) return new Response(JSON.stringify(edgeView));
    if (url.startsWith("/api/revert/preview")) return new Response(JSON.stringify({ retired: 1, restored: 2, changed: 0, declined: 1 }));
    if (url.startsWith("/api/timeline")) return new Response(JSON.stringify([change("x1", { target: "a", status: "approved" }).event, { ...change("bad", { target: "a", status: "parked" }).event }, { id: "w", hlc: HLC, type: "SessionOpened", actor: "user", body: { purpose: "x" } }]));
    return new Response(JSON.stringify({ nodes: {}, edges: {} }));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("item actions", () => {
  it("restores a declined item", async () => {
    const onDone = vi.fn();
    render(<ItemActions id="x" status="declined" onDone={onDone} />);
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: "restore", ids: ["x"] }));
    expect(posted[0]).toEqual({ url: "/api/restore", body: { id: "x" } });
  });
});

describe("undo bar", () => {
  it("appears only after a decline", () => {
    const onUndo = vi.fn();
    const onClose = vi.fn();
    const { rerender, container } = render(<UndoBar done={{ kind: "approve", ids: ["a"] }} onUndo={onUndo} onClose={onClose} />);
    expect(container.innerHTML).toBe("");
    rerender(<UndoBar done={{ kind: "decline", ids: ["a", "b"] }} onUndo={onUndo} onClose={onClose} />);
    expect(screen.getByText("Declined 2 items.")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onUndo).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    rerender(<UndoBar done={{ kind: "decline", ids: ["a"] }} onUndo={onUndo} onClose={onClose} />);
    expect(screen.getByText("Declined 1 item.")).toBeTruthy();
  });
});

describe("edge panel", () => {
  it("shows a declined edge with Restore and lets you jump to its endpoints", async () => {
    const onSelect = vi.fn();
    const onReviewed = vi.fn();
    render(<EdgePanel id="e1" labels={{ e1: "A → B" }} readOnly={false} onReviewed={onReviewed} onSelect={onSelect} navigate={vi.fn()} />);
    expect(await screen.findByText(/Restore brings it back/)).toBeTruthy();
    expect(screen.getByText(/A → B → approved/)).toBeTruthy();
    expect(screen.getByText(/reinforces \(increases\)/)).toBeTruthy();
    fireEvent.click(screen.getByText("A"));
    expect(onSelect).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith({ kind: "restore", ids: ["e1"] }));
    fireEvent.click(screen.getByRole("button", { name: /Open “T”/ }));
  });

  it("is read-only in the past and describes decreases", async () => {
    edgeView.edge = { ...edgeView.edge, sign: -1, status: "approved", held: true };
    edgeView.reasons = ["closes a feedback loop"];
    render(<EdgePanel id="e1" labels={{}} readOnly onReviewed={vi.fn()} onSelect={vi.fn()} navigate={vi.fn()} />);
    expect(await screen.findByText(/decreases/)).toBeTruthy();
    expect(screen.getByText(/closes a feedback loop/)).toBeTruthy();
    expect(screen.queryByText("Decline")).toBeNull();
    edgeView.edge = { ...edgeView.edge, sign: undefined };
  });
});

describe("revert", () => {
  it("describes and confirms a revert, or cancels", async () => {
    expect(describeRevert({ retired: 0, restored: 0, changed: 0, declined: 0 })).toBe("Nothing has changed since this point.");
    expect(describeRevert({ retired: 2, restored: 1, changed: 1, declined: 3 })).toBe("This will retire 2 items added since, restore 1 status, undo 1 edit, decline 3 waiting proposals.");
    const onReverted = vi.fn();
    render(<RevertControl position={HLC} onReverted={onReverted} />);
    fireEvent.click(screen.getByText("Revert to here…"));
    expect(await screen.findByText(/retire 1 item added since, restore 2 statuses, decline 1 waiting proposal/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Revert to here…"));
    fireEvent.click(await screen.findByText("Revert"));
    await waitFor(() => expect(onReverted).toHaveBeenCalled());
    expect(posted.at(-1)).toEqual({ url: "/api/revert", body: { t: HLC } });
  });

  it("shows the revert control only while looking at the past", () => {
    const { rerender } = render(<TimeBar positions={[HLC, HLC]} index={undefined} onChange={vi.fn()} onReverted={vi.fn()} />);
    expect(screen.queryByText("Revert to here…")).toBeNull();
    rerender(<TimeBar positions={[HLC, `${HLC}x`]} index={0} onChange={vi.fn()} onReverted={vi.fn()} />);
    expect(screen.getByText("Revert to here…")).toBeTruthy();
  });

  it("reports preview failures", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"bad position"}', { status: 400 }));
    render(<RevertControl position="x" onReverted={vi.fn()} />);
    fireEvent.click(screen.getByText("Revert to here…"));
    expect(await screen.findByText("bad position")).toBeTruthy();
  });
});

describe("log undo", () => {
  it("offers Undo on graph changes and reports failures", async () => {
    expect(undoable({ type: "SessionOpened" } as AnyEvent)).toBe(false);
    render(<LogView />);
    const buttons = await screen.findAllByText("Undo");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(posted[0]).toEqual({ url: "/api/undo", body: { eventId: "x1" } }));
    fireEvent.click(buttons[1]);
    expect(await screen.findByText("cannot")).toBeTruthy();
  });
});
