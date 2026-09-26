// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionChanges } from "../api";
import { ChangesPanel } from "./ChangesPanel";
import { ItemActions, UndoBar, kindsFor } from "./ItemControls";
import { StatusBar } from "./StatusBar";

const HLC = "001758800000000.000000.d";
const change = (session: string, rows: SessionChanges["rows"]): SessionChanges => ({ session, actor: "model:gemma", purpose: "ingest", at: HLC, rows });
const CHANGES = [
  change("s1", [
    { id: "h", kind: "entry", label: "Tuesday", action: "added" },
    { id: "n1", kind: "node", label: "The Hider", action: "added" },
    { id: "n2", kind: "node", label: "Controller", action: "renamed", detail: "The Controller" },
  ]),
  { ...change("s2", [{ id: "n3", kind: "node", label: "X", action: "removed" }]), purpose: "mystery" },
];

let posted: { url: string; body: unknown }[];
beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.body) posted.push({ url, body: JSON.parse(String(init.body)) });
    if (url.startsWith("/api/changes")) return new Response(JSON.stringify(CHANGES));
    return url.includes("remove") ? new Response('{"error":"nope"}', { status: 400 }) : new Response("{}");
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("item actions", () => {
  it("offer what fits the items: confirm while unconfirmed, remove while on the map, restore once removed", () => {
    expect(kindsFor([{ status: "active", confirmed: false }])).toEqual(["confirm", "remove"]);
    expect(kindsFor([{ status: "active", confirmed: true }])).toEqual(["remove"]);
    expect(kindsFor([{ status: "removed", confirmed: false }])).toEqual(["restore"]);
    expect(kindsFor([{ status: "removed", confirmed: false }, { status: "active", confirmed: true }])).toEqual(["remove"]);
    expect(kindsFor([])).toEqual(["remove"]);
  });

  it("run actions, count selections and report errors", async () => {
    const onDone = vi.fn();
    render(<ItemActions ids={["a", "b"]} items={[{ status: "active", confirmed: false }]} onDone={onDone} count />);
    fireEvent.click(screen.getByText("Looks right 2"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: "confirm", ids: ["a", "b"] }));
    expect(posted[0]).toEqual({ url: "/api/confirm", body: { ids: ["a", "b"] } });
    fireEvent.click(screen.getByText("Remove 2"));
    expect(await screen.findByText("nope")).toBeTruthy();
    cleanup();
    render(<ItemActions ids={["a"]} items={[{ status: "removed", confirmed: false }]} onDone={onDone} />);
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ kind: "restore", ids: ["a"] }));
  });
});

describe("undo bar", () => {
  it("appears only after a removal", () => {
    const onUndo = vi.fn();
    const onClose = vi.fn();
    const { rerender, container } = render(<UndoBar done={{ kind: "confirm", ids: ["a"] }} onUndo={onUndo} onClose={onClose} />);
    expect(container.innerHTML).toBe("");
    rerender(<UndoBar done={{ kind: "remove", ids: ["a", "b"] }} onUndo={onUndo} onClose={onClose} />);
    expect(screen.getByText("Removed 2 items.")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onUndo).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    rerender(<UndoBar done={{ kind: "remove", ids: ["a"] }} onUndo={onUndo} onClose={onClose} />);
    expect(screen.getByText("Removed 1 item.")).toBeTruthy();
  });
});

describe("what changed", () => {
  it("lists sessions with their rows, focuses items, undoes a session and merges duplicates", async () => {
    const onFocus = vi.fn();
    const onChanged = vi.fn();
    render(<ChangesPanel version="1" duplicates={[{ kind: "node", ids: ["n1", "n4"], reason: "same" }]} labels={{ n1: "The Hider" }} onFocus={onFocus} onChanged={onChanged} onClose={vi.fn()} />);
    expect(await screen.findByText("New entry")).toBeTruthy();
    expect(screen.getByText("mystery")).toBeTruthy();
    expect(screen.getByText("· The Controller")).toBeTruthy();
    fireEvent.click(screen.getByText("New entry"));
    expect(onFocus).toHaveBeenCalledWith(["n1", "n2"]);
    fireEvent.click(screen.getByText("The Hider", { selector: "span" }));
    expect(onFocus).toHaveBeenCalledWith(["n1"]);
    fireEvent.click(screen.getAllByText("Undo")[0]);
    await waitFor(() => expect(posted).toContainEqual({ url: "/api/undo-session", body: { session: "s1" } }));
    fireEvent.click(screen.getByText("“The Hider” is recorded 2 times"));
    expect(onFocus).toHaveBeenCalledWith(["n1", "n4"]);
    fireEvent.click(screen.getByText("Merge"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it("says when nothing has changed and reports undo failures", async () => {
    vi.stubGlobal("fetch", async (url: string) => (url.startsWith("/api/changes") ? new Response("[]") : new Response('{"error":"bad"}', { status: 400 })));
    render(<ChangesPanel version="1" labels={{}} onFocus={vi.fn()} onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("Nothing yet.")).toBeTruthy();
  });
});

describe("status bar", () => {
  it("opens what changed, counts duplicates and toggles removed items", () => {
    const onChanges = vi.fn();
    const onShowRemoved = vi.fn();
    const { rerender } = render(<StatusBar counts={{ active: 4, removed: 2 }} showRemoved={false} onShowRemoved={onShowRemoved} changesOpen={false} onChanges={onChanges} duplicates={2} />);
    fireEvent.click(screen.getByText("What changed"));
    expect(onChanges).toHaveBeenCalled();
    expect(screen.getByText("2 duplicates")).toBeTruthy();
    expect(screen.getByText("4 on the map")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show removed (2)"));
    expect(onShowRemoved).toHaveBeenCalledWith(true);
    rerender(<StatusBar showRemoved changesOpen onShowRemoved={onShowRemoved} onChanges={onChanges} duplicates={1} />);
    expect(screen.getByText("1 duplicate")).toBeTruthy();
    expect(screen.getByText("0 on the map")).toBeTruthy();
  });
});
