// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Call, failure, fakeServer, sent } from "../testing/fakeServer";
import type { EntryView, NodeView } from "../api";
import { Button, Card, Empty, ErrorNote, Page, Quote, StatusPill } from "../components/ui";
import { EntriesView, EntryText, SupportedItems } from "./EntriesView";
import { LogView } from "./LogView";
import { LoopCard, LoopsView } from "./LoopsView";
import { NodePanel } from "./NodePanel";
import { Related } from "../components/Related";
import { useJob } from "../lib/useJob";

// Cytoscape needs a real canvas; the Map view is covered in MapView.test.tsx.
vi.mock("../components/GraphCanvas", () => ({ GraphCanvas: () => <div data-testid="graph-canvas" /> }));

const HLC = "001758800000000.000000.d";
const base = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "model:m", assertedAt: HLC, updatedAt: HLC, derivedFrom: [], confirmed: false, staleEvidence: 0 };
const graph = {
  nodes: {
    n1: { ...base, id: "n1", type: "belief", label: "Needing is unsafe", status: "active" },
    n2: { ...base, id: "n2", type: "core_memory", label: "Dinner table", status: "active", confirmed: true },
  },
  edges: {},
  counts: { active: 2, removed: 0 },
  position: HLC,
};
const text = "I learned that needing things is unsafe.";
const nodeEvent = {
  id: "ev1",
  hlc: HLC,
  device: "d",
  actor: "model:m",
  session: "s1",
  parents: [],
  type: "NodeAsserted",
  body: { id: "n3", type: "belief", label: "New one", attributes: {}, confidence: 0.7, evidence: [{ entry: "h", start: 15, end: 28 }] },
};
const entryView: EntryView = {
  entry: { id: "h", source: "text", title: "Tuesday", bytes: 40, addedAt: HLC, session: "s1" },
  text,
  citations: [{ target: "n1", label: "Needing is unsafe", evidence: { entry: "h", start: 15, end: 39 } }],
};
const nodeView = {
  node: graph.nodes.n1,
  evidence: [{ entry: "h", start: 15, end: 39, text: "needing things is unsafe", entryTitle: "Tuesday" }],
  outgoing: [{ id: "e1", type: "scaffolds", from: "n1", to: "n2", status: "active" }],
  incoming: [{ id: "e2", type: "abduces", from: "n2", to: "n1", status: "removed" }],
  derivedFrom: [{ ...graph.nodes.n2 }],
  derivedInto: [],
} as unknown as NodeView;

const step = (edge: string, from: string, to: string, sign: 1 | -1, confidence: number) => ({
  edge,
  type: "reinforces",
  from,
  to,
  sign,
  confidence,
  fromLabel: from.toUpperCase(),
  toLabel: to.toUpperCase(),
  quotes: [`quote ${edge}`],
});
const LOOP = {
  nodes: ["a", "b"],
  edges: ["ab", "ba"],
  polarity: "reinforcing",
  steps: [step("ab", "a", "b", 1, 0.9), step("ba", "b", "a", 1, 0.4)],
  inputs: [step("rb", "r", "b", -1, 0.7), step("fa", "f", "a", 1, 0.7)],
  outputs: [step("ax", "a", "x", 1, 0.5)],
  weakest: step("ba", "b", "a", 1, 0.4),
  certainty: 0.36,
  linkedLoops: 1,
};

const routes: Record<string, unknown> = {
  "/api/schema": { name: "author", version: 1, nodeTypes: {}, edgeTypes: {} },
  "/api/view": graph,
  "/api/graph": graph,
  "/api/duplicates": [],
  "/api/entries": [entryView.entry],
  "/api/entries/h": entryView,
  "/api/loops": [LOOP],
  "/api/timeline": [nodeEvent],
  "/api/nodes/n1": nodeView,
  "/api/nodes/n1/roots": { node: "n1", upstream: ["n2"], roots: [{ id: "n2", support: 1, path: ["n2", "n1"] }] },
  "/api/nodes/n1/related": [{ id: "h", kind: "entry", score: 0.5, terms: [], title: "Tuesday", snippet: "needing" }],
  "/api/jobs/s2": { id: "s2", name: "interpret", state: "done" },
  "/api/positions": [HLC],
};

let calls: Call[];

beforeEach(() => {
  calls = fakeServer((call) => {
    if (call.method === "POST") {
      if (call.path === "/api/entries")
        return {
          session: "s2",
          entry: "h2",
          related: [{ id: "h", kind: "entry", score: 0.4, terms: [], title: "Tuesday", snippet: "old words" }],
          job: { id: "s2", name: "interpret", state: "queued" },
        };
      return { ok: true };
    }
    return routes[call.path];
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ui primitives", () => {
  it("render", () => {
    render(
      <Page title="T" subtitle="S" actions={<Button tone="danger">x</Button>}>
        <Card>c</Card>
        <Empty>e</Empty>
        <ErrorNote error="bad" />
        <ErrorNote />
        <StatusPill status="accepted" />
        <StatusPill status="other" />
        <Quote source="src">q</Quote>
        <Quote>q2</Quote>
      </Page>,
    );
    expect(screen.getByText("bad")).toBeTruthy();
    expect(screen.getByText("— src")).toBeTruthy();
  });
});

describe("SupportedItems", () => {
  it("lists what an entry supports and opens each", () => {
    const onOpen = vi.fn();
    const citations = [...entryView.citations, { target: "e1", label: "An edge", evidence: { entry: "h", start: 0, end: 3 } }, entryView.citations[0]];
    render(<SupportedItems view={{ ...entryView, citations }} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("An edge"));
    expect(onOpen.mock.calls).toEqual([["e1"]]);
    render(<SupportedItems view={{ ...entryView, citations: [] }} onOpen={onOpen} />);
    expect(screen.getByText(/Nothing on the map cites/)).toBeTruthy();
  });
});

describe("Related and useJob", () => {
  it("shows related material straight away, or says there is none", () => {
    const onSelect = vi.fn();
    const onOpenEntry = vi.fn();
    render(<Related items={[]} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    expect(screen.getByText("Nothing from before looks related.")).toBeTruthy();
    const items = [
      { id: "h", kind: "entry" as const, score: 0.4, terms: [], title: "Tuesday", snippet: "old words" },
      { id: "n2", kind: "node" as const, score: 0.3, terms: [], title: "Dinner table", snippet: "dinner" },
    ];
    render(<Related items={items} onSelect={onSelect} onOpenEntry={onOpenEntry} />);
    expect(screen.getByText("old words")).toBeTruthy();
    fireEvent.click(screen.getByText("Tuesday"));
    fireEvent.click(screen.getByText("Dinner table"));
    expect([onOpenEntry.mock.calls, onSelect.mock.calls]).toEqual([[["h"]], [["n2"]]]);
  });

  it("keeps polling running jobs and reports failures", async () => {
    const states = ["running", "failed"];
    fakeServer(() => ({ id: "j", name: "i", state: states.shift() ?? "failed", error: "model offline" }));
    function Probe() {
      const job = useJob("j", 5);
      return <p>{job?.state ?? "none"}</p>;
    }
    render(<Probe />);
    expect(await screen.findByText("failed")).toBeTruthy();
  });
});

describe("LoopsView and LogView", () => {
  it("shows loop structure, implications and opens the loop on the map", async () => {
    const navigate = vi.fn();
    render(<LoopsView navigate={navigate} />);
    expect(await screen.findByText("Reinforcing loop: it feeds itself")).toBeTruthy();
    expect(screen.getByText("A → B → A")).toBeTruthy();
    expect(screen.getByText(/“R” calms “B” from outside the loop/)).toBeTruthy();
    expect(screen.getByText(/“F” feeds “A”/)).toBeTruthy();
    expect(screen.getByText(/least certain link is B → A \(40%\)/)).toBeTruthy();
    expect(screen.getByText("What this loop drives")).toBeTruthy();
    expect(screen.getByText(/overlapping 1 other loop$/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show on map"));
    expect(navigate).toHaveBeenCalledWith("map", "a,b,ab,ba");
  });

  it("renders a certain balancing loop without extra notes", () => {
    const loop = {
      ...LOOP,
      polarity: "balancing" as const,
      steps: [step("ab", "a", "b", -1, 0.9)],
      inputs: [],
      outputs: [],
      weakest: step("ab", "a", "b", -1, 0.9),
      certainty: 0.9,
      linkedLoops: 2,
    };
    render(<LoopCard loop={loop} onOpen={vi.fn()} />);
    expect(screen.getByText("Balancing loop: it holds itself steady")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/2 other loops/)).toBeTruthy();
  });

  it("renders the log", async () => {
    render(<LogView />);
    expect(await screen.findByText("belief: “New one” (70%)")).toBeTruthy();
  });
});

describe("EntriesView", () => {
  it("shows entry text with clickable citations", async () => {
    const navigate = vi.fn();
    render(<EntriesView focus="h@0-9" navigate={navigate} />);
    expect(await screen.findByText("I learned")).toBeTruthy();
    const mark = await screen.findByRole("button", { name: /^needing things is unsafe — supports/ });
    fireEvent.click(mark);
    fireEvent.keyDown(mark, { key: "Enter" });
    expect(navigate).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(navigate).toHaveBeenLastCalledWith("map", "n1");
    fireEvent.click(screen.getByText("Tuesday"));
  });

  it("lights a passage's items when the pointer is on it, and a chip's passages when it is on the chip", async () => {
    render(<EntriesView focus="h" navigate={vi.fn()} />);
    const mark = await screen.findByRole("button", { name: /— supports Needing is unsafe/ });
    const chip = () =>
      screen
        .getAllByTitle("Needing is unsafe")
        .find((e) => e.tagName === "BUTTON")
        ?.closest("[data-tone]") as HTMLElement;
    fireEvent.mouseEnter(mark);
    expect(chip().dataset.lit).toBe("true");
    fireEvent.mouseLeave(mark);
    expect(chip().dataset.lit).toBeUndefined();
    fireEvent.mouseEnter(chip());
    expect(mark.className).toMatch(/(^| )underline( |$)/);
    fireEvent.mouseLeave(chip());
    expect(mark.className).not.toMatch(/(^| )underline( |$)/);
  });

  it("follows renames made elsewhere as they happen", async () => {
    const sources: { emit: (data: string) => void }[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        listeners: ((e: { data: string }) => void)[] = [];
        constructor() {
          sources.push({
            emit: (data) => {
              for (const fn of this.listeners) fn({ data });
            },
          });
        }
        addEventListener(_: string, fn: (e: { data: string }) => void) {
          this.listeners.push(fn);
        }
        close() {}
      },
    );
    render(<EntriesView focus="h" navigate={vi.fn()} />);
    expect(await screen.findByText("Needing is unsafe")).toBeTruthy();
    routes["/api/entries/h"] = { ...entryView, citations: [{ ...entryView.citations[0], label: "Needing is allowed" }] };
    for (const source of sources) source.emit("p1"), source.emit("p2");
    expect(await screen.findByText("Needing is allowed")).toBeTruthy();
    routes["/api/entries/h"] = entryView;
  });

  it("edits an entry and reports how evidence carried over", async () => {
    calls = fakeServer((call) => {
      if (call.method === "POST")
        return call.path.includes("fail")
          ? failure("The Entry is unchanged")
          : { session: "s9", entry: "h", previous: "h0", remapped: 1, cited: [{ moved: false }, { moved: true }] };
      return routes[call.path] ?? { id: "s9", state: "running" };
    });
    render(<EntriesView focus="h" navigate={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("Edit"));
    fireEvent.change(screen.getByLabelText("Entry text"), { target: { value: "I learned that needing things is fine." } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Save revision"));
    expect(await screen.findByText(/1 cited passage carried over; 1 item cite text that changed/)).toBeTruthy();
    expect(sent(calls)[0]).toEqual({ url: "/api/entries/h/revise", body: { content: "I learned that needing things is fine.", interpret: false } });
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.click(screen.getByText("Cancel"));
  });

  it("shows revision errors", async () => {
    fakeServer((call) => (call.method === "POST" ? failure("The Entry is unchanged") : entryView));
    const { EntryEditor } = await import("./EntriesView");
    render(<EntryEditor view={entryView} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Entry text"), { target: { value: "changed" } });
    fireEvent.click(screen.getByText("Save revision"));
    expect(await screen.findByText("The Entry is unchanged")).toBeTruthy();
  });

  it("renders plain text without citations", () => {
    render(<EntryText view={{ ...entryView, citations: [] }} onOpen={vi.fn()} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("NodePanel", () => {
  const props = { id: "n1", labels: { n1: "Needing is unsafe", n2: "Dinner table" }, readOnly: false, onDone: vi.fn(), onHighlight: vi.fn(), navigate: vi.fn() };

  it("shows evidence, edges and lineage, and runs actions", async () => {
    render(<NodePanel {...props} />);
    expect(await screen.findByText("Needing is unsafe", { selector: "h3" })).toBeTruthy();
    expect(screen.getByText("From here")).toBeTruthy();
    expect(screen.getByText("Into here")).toBeTruthy();
    const outgoing = screen.getByText("scaffolds").closest("button") as HTMLElement;
    expect(outgoing.textContent).toBe("scaffoldsDinner table");
    const incoming = screen.getByText("abduces").closest("button") as HTMLElement;
    expect([incoming.textContent, incoming.innerHTML.includes("line-through")]).toEqual(["Dinner tableabduces", true]);
    expect(screen.getByText("Came from")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Looks right"));
    fireEvent.click(screen.getByText("Where it starts"));
    expect(await screen.findByText("Leads on to 1 thing")).toBeTruthy();
    fireEvent.click(screen.getByText("Related"));
    expect(await screen.findByText("needing")).toBeTruthy();
    fireEvent.doubleClick(screen.getByText("Needing is unsafe", { selector: "h3" }));
    fireEvent.keyDown(screen.getByLabelText("Rename"), { key: "Escape" });
    fireEvent.doubleClick(screen.getByText("Needing is unsafe", { selector: "h3" }));
    fireEvent.change(screen.getByLabelText("Rename"), { target: { value: "Renamed" } });
    fireEvent.keyDown(screen.getByLabelText("Rename"), { key: "Enter" });
    fireEvent.click(screen.getByText(/needing things is unsafe/));
    await waitFor(() => expect(sent(calls).map((p) => p.url)).toEqual(["/api/confirm", "/api/items/n1/attributes"]));
    expect(props.onHighlight).toHaveBeenCalledWith(["n2", "n1"]);
    expect(props.navigate).toHaveBeenCalledWith("entries", "h@15-39");
    expect(screen.getByRole("button", { name: "Open “Tuesday” at this passage" })).toBeTruthy();
  });

  it("is read-only in the past and offers Restore for removed nodes", async () => {
    routes["/api/nodes/n1"] = { ...nodeView, node: { ...graph.nodes.n1, status: "removed" }, outgoing: [], incoming: [], derivedFrom: [] };
    const { unmount } = render(<NodePanel {...props} readOnly />);
    expect(await screen.findByText("Not linked to anything yet.")).toBeTruthy();
    expect(screen.queryByLabelText("Restore")).toBeNull();
    unmount();
    render(<NodePanel {...props} />);
    expect(await screen.findByText(/Removed. Restore puts it back/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restore"));
    routes["/api/nodes/n1"] = nodeView;
  });

  it("shows when nothing leads to a node, and errors", async () => {
    routes["/api/nodes/n1/roots"] = { node: "n1", upstream: [], roots: [] };
    render(<NodePanel {...props} id="n1" />);
    fireEvent.click(await screen.findByText("Where it starts"));
    expect(await screen.findByText(/It is where things start/)).toBeTruthy();
    cleanup();
    render(<NodePanel {...props} id="missing" />);
    expect(await screen.findByText("missing")).toBeTruthy();
  });
});

it("act is available for async effects", async () => {
  await act(async () => {});
});
