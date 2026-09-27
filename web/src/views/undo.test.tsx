// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Call, failure, fakeServer, sent } from "../testing/fakeServer";
import type { AnyEvent } from "../api";
import { EdgePanel } from "./EdgePanel";
import { LogView, undoable } from "./LogView";
import { RevertControl, TimeBar, describeRevert } from "./TimeBar";

const HLC = "001758800000000.000000.d";
const base = { attributes: {}, confidence: 0.8, evidence: [], assertedBy: "agent:c", assertedAt: HLC, updatedAt: HLC, confirmed: false, staleEvidence: 0 };
const change = (id: string, body: object, type = "StatusChanged") => ({
  event: { id, hlc: HLC, device: "d", actor: "model:g", session: "s", parents: [], type, body } as AnyEvent,
});
const edgeView = {
  edge: { ...base, id: "e1", type: "reinforces", from: "a", to: "b", sign: 1 as number | undefined, status: "removed", staleEvidence: 2 },
  fromLabel: "A",
  toLabel: "B",
  evidence: [{ entry: "h", start: 0, end: 5, text: "quote", entryTitle: "T", before: "", after: "" }],
};

let calls: Call[];
beforeEach(() => {
  calls = fakeServer((call) => {
    if (call.method === "POST") {
      return call.path.includes("/undo") && (call.body as { eventId?: string }).eventId === "bad"
        ? failure("cannot")
        : { session: "s", summary: { retired: 1, restored: 0, changed: 2 } };
    }
    if (call.path.startsWith("/api/edges")) return edgeView;
    if (call.path.startsWith("/api/revert/preview")) return { retired: 1, restored: 2, changed: 0 };
    if (call.path.startsWith("/api/timeline"))
      return [
        change("x1", { target: "a", status: "accepted" }).event,
        { ...change("bad", { target: "a", status: "superseded" }).event },
        { id: "w", hlc: HLC, type: "SessionOpened", actor: "user", body: { purpose: "x" } },
      ];
    return { nodes: {}, edges: {} };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("edge panel", () => {
  it("shows a removed edge with Restore and lets you jump to its endpoints", async () => {
    const onSelect = vi.fn();
    const onDone = vi.fn();
    render(<EdgePanel id="e1" labels={{ e1: "A → B" }} readOnly={false} onDone={onDone} onSelect={onSelect} navigate={vi.fn()} />);
    expect(await screen.findByText(/Restore puts it back/)).toBeTruthy();
    expect(screen.getByText("removed")).toBeTruthy();
    expect(screen.getByText("increases")).toBeTruthy();
    expect(screen.getByText("reinforces")).toBeTruthy();
    fireEvent.click(screen.getByText("A"));
    expect(onSelect).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: "restore", ids: ["e1"] }));
    expect(sent(calls)[0]).toEqual({ url: "/api/restore", body: { id: "e1" } });
    fireEvent.click(screen.getByRole("button", { name: /Open “T”/ }));
  });

  it("is read-only in the past and describes decreases", async () => {
    edgeView.edge = { ...edgeView.edge, sign: -1, status: "active", confirmed: true };
    render(<EdgePanel id="e1" labels={{}} readOnly onDone={vi.fn()} onSelect={vi.fn()} navigate={vi.fn()} />);
    expect(await screen.findByText("decreases")).toBeTruthy();
    expect(screen.queryByText("confirmed")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
    edgeView.edge = { ...edgeView.edge, sign: undefined };
  });
});

describe("revert", () => {
  it("describes and confirms a revert, or cancels", async () => {
    expect(describeRevert({ retired: 0, restored: 0, changed: 0 })).toBe("Nothing has changed since this point.");
    expect(describeRevert({ retired: 2, restored: 1, changed: 1 })).toBe("This will remove 2 items added since, restore 1 status, undo 1 edit.");
    const onReverted = vi.fn();
    render(<RevertControl position={HLC} onReverted={onReverted} />);
    fireEvent.click(screen.getByText("Revert to here…"));
    expect(await screen.findByText(/remove 1 item added since, restore 2 statuses/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Revert to here…"));
    fireEvent.click(await screen.findByText("Revert"));
    await waitFor(() => expect(onReverted).toHaveBeenCalled());
    expect(sent(calls).at(-1)).toEqual({ url: "/api/revert", body: { t: HLC } });
  });

  it("shows the revert control only while looking at the past", () => {
    const { rerender } = render(<TimeBar positions={[HLC, HLC]} index={undefined} onChange={vi.fn()} onReverted={vi.fn()} />);
    expect(screen.queryByText("Revert to here…")).toBeNull();
    rerender(<TimeBar positions={[HLC, `${HLC}x`]} index={0} onChange={vi.fn()} onReverted={vi.fn()} />);
    expect(screen.getByText("Revert to here…")).toBeTruthy();
  });

  it("reports preview failures", async () => {
    fakeServer(() => failure("bad position"));
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
    await waitFor(() => expect(sent(calls)[0]).toEqual({ url: "/api/undo", body: { eventId: "x1" } }));
    fireEvent.click(buttons[1]);
    expect(await screen.findByText("cannot")).toBeTruthy();
  });
});
