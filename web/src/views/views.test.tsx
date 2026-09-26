// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { EntryView, NodeView, ProposalView } from "../api";
import { Button, Card, Empty, ErrorNote, Page, Quote, StatusPill } from "../components/ui";
import { EntriesView, EntryText } from "./EntriesView";
import { LogView } from "./LogView";
import { LoopCard, LoopsView } from "./LoopsView";
import { NodePanel } from "./NodePanel";
import { ProposalCard, ReviewView, evidenceOf } from "./ReviewView";
import { Related, WriteView, useJob } from "./WriteView";

const HLC = "001758800000000.000000.d";
const base = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "model:m", assertedAt: HLC, updatedAt: HLC, derivedFrom: [] };
const graph = {
  nodes: {
    n1: { ...base, id: "n1", type: "belief", label: "Needing is unsafe", status: "hypothesis" },
    n2: { ...base, id: "n2", type: "core_memory", label: "Dinner table", status: "parked" },
  },
  edges: {},
};
const text = "I learned that needing things is unsafe.";
const nodeEvent = { id: "ev1", hlc: HLC, device: "d", actor: "model:m", session: "s1", parents: [], type: "NodeAsserted", body: { id: "n3", type: "belief", label: "New one", attributes: {}, confidence: 0.7, evidence: [{ entry: "h", start: 15, end: 28 }] } };
const proposal = { session: "s1", actor: "user", purpose: "ingest", entry: "h", entryTitle: "Tuesday", openedAt: HLC, closed: true, pending: 1, items: [{ event: nodeEvent, decision: "pending", reasons: ["new root-level node"] }] } as unknown as ProposalView;
const entryView: EntryView = {
  entry: { id: "h", source: "text", title: "Tuesday", bytes: 40, addedAt: HLC, session: "s1" },
  text,
  citations: [{ target: "n1", label: "Needing is unsafe", evidence: { entry: "h", start: 15, end: 39 } }],
};
const nodeView = {
  node: graph.nodes.n1,
  evidence: [{ entry: "h", start: 15, end: 39, text: "needing things is unsafe", entryTitle: "Tuesday" }],
  outgoing: [{ id: "e1", type: "scaffolds", from: "n1", to: "n2" }],
  incoming: [{ id: "e2", type: "abduces", from: "n2", to: "n1" }],
  derivedFrom: [{ ...graph.nodes.n2 }],
  derivedInto: [],
} as unknown as NodeView;

const routes: Record<string, unknown> = {
  "/api/status": { model: "gemma", hosted: true, schema: { name: "author", version: 1, nodeTypes: {}, edgeTypes: {} } },
  "/api/proposals": [proposal],
  "/api/graph": graph,
  "/api/entries": [entryView.entry],
  "/api/entries/h": entryView,
  "/api/loops": [{ nodes: ["n1", "n2"], edges: ["a", "b"], polarity: "reinforcing" }],
  "/api/timeline": [nodeEvent],
  "/api/nodes/n1": nodeView,
  "/api/nodes/n1/roots": { node: "n1", upstream: ["n2"], roots: [{ id: "n2", support: 1, path: ["n2", "n1"] }] },
  "/api/nodes/n1/related": [{ id: "h", kind: "entry", score: 0.5, terms: [], title: "Tuesday", snippet: "needing" }],
  "/api/jobs/s2": { id: "s2", name: "interpret", state: "done" },
  "/api/positions": [HLC],
};

let posted: { url: string; body: unknown }[];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0];
    if (init?.method === "POST") {
      posted.push({ url: path, body: JSON.parse(String(init.body)) });
      if (path === "/api/entries") return new Response(JSON.stringify({ session: "s2", entry: "h2", related: [{ id: "h", kind: "entry", score: 0.4, terms: [], title: "Tuesday", snippet: "old words" }], job: { id: "s2", name: "interpret", state: "queued" } }));
      return new Response(JSON.stringify({ ok: true }));
    }
    const body = routes[path];
    return body === undefined ? new Response('{"error":"missing"}', { status: 404 }) : new Response(JSON.stringify(body));
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

describe("App shell", () => {
  it("shows the hosted notice and navigates between views", async () => {
    render(<App />);
    expect(await screen.findByText(/entry text leaves this device/)).toBeTruthy();
    expect(await screen.findByText("1")).toBeTruthy();
    for (const label of ["Review", "Loops", "Entries", "Log", "Write"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
    }
    expect(screen.getByPlaceholderText("Write freely…")).toBeTruthy();
  });
});

describe("WriteView", () => {
  it("adds an entry, polls the job and offers related material", async () => {
    const navigate = vi.fn();
    render(<WriteView navigate={navigate} />);
    fireEvent.change(screen.getByPlaceholderText("Title (optional)"), { target: { value: "Title" } });
    fireEvent.change(screen.getByPlaceholderText("Write freely…"), { target: { value: "Something happened" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "markdown" } });
    fireEvent.click(screen.getByText("Add entry"));
    await screen.findByText(/Proposal ready/);
    expect(posted[0].body).toEqual({ content: "Something happened", title: "Title", format: "markdown" });
    fireEvent.click(screen.getByText("Open review"));
    expect(navigate).toHaveBeenCalledWith("review");
    fireEvent.click(screen.getByText(/may be related \(1\)/));
    expect(screen.getByText("old words")).toBeTruthy();
    fireEvent.click(screen.getByText("Hide related material"));
  });

  it("shows errors when adding fails", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"Entry is empty"}', { status: 400 }));
    render(<WriteView navigate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Write freely…"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Add entry"));
    expect(await screen.findByText("Entry is empty")).toBeTruthy();
  });

  it("renders nothing when nothing is related", () => {
    const { container } = render(<Related items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("keeps polling running jobs and reports failures", async () => {
    const states = ["running", "failed"];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "j", name: "i", state: states.shift() ?? "failed", error: "model offline" })));
    function Probe() {
      const job = useJob("j", 5);
      return <p>{job?.state ?? "none"}</p>;
    }
    render(<Probe />);
    expect(await screen.findByText("failed")).toBeTruthy();
  });
});

describe("ReviewView", () => {
  it("lists proposals with reasons and evidence, and records decisions", async () => {
    render(<ReviewView />);
    expect(await screen.findByText("new root-level node")).toBeTruthy();
    expect(await screen.findByText(/needing thing/)).toBeTruthy();
    fireEvent.click(screen.getByText("Accept"));
    fireEvent.click(screen.getByText("Decline all"));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0].body).toEqual({ accept: ["ev1"] });
    expect(posted[1].body).toEqual({ reject: ["ev1"] });
  });

  it("shows review errors and an empty state", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Response('{"error":"conflict"}', { status: 400 }) : new Response(JSON.stringify(url.includes("proposals") ? [] : graph)),
    );
    render(<ProposalCard proposal={{ ...proposal, entry: undefined }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText("Accept all"));
    expect(await screen.findByText("conflict")).toBeTruthy();
    cleanup();
    render(<ReviewView />);
    expect(await screen.findByText("Nothing is waiting for review.")).toBeTruthy();
  });

  it("reads evidence from events that carry it", () => {
    expect(evidenceOf({ event: { body: {} } } as never)).toEqual([]);
  });
});

describe("LoopsView and LogView", () => {
  it("shows loops and opens a node on the map", async () => {
    const navigate = vi.fn();
    render(<LoopsView navigate={navigate} />);
    expect(await screen.findByText(/Reinforcing/)).toBeTruthy();
    fireEvent.click(screen.getAllByText("Needing is unsafe")[0]);
    expect(navigate).toHaveBeenCalledWith("map", "n1");
  });

  it("renders a balancing loop with unknown labels", () => {
    render(<LoopCard loop={{ nodes: ["x"], edges: ["e"], polarity: "balancing" }} labels={{}} onOpen={vi.fn()} />);
    expect(screen.getAllByText("x")).toHaveLength(2);
  });

  it("renders the log", async () => {
    render(<LogView />);
    expect(await screen.findByText("belief: “New one” · 70%")).toBeTruthy();
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
    fireEvent.click(screen.getByText("Tuesday"));
  });

  it("renders plain text without citations", () => {
    render(<EntryText view={{ ...entryView, citations: [] }} onOpen={vi.fn()} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("NodePanel", () => {
  const props = { id: "n1", labels: { n1: "Needing is unsafe", n2: "Dinner table" }, readOnly: false, onChanged: vi.fn(), onHighlight: vi.fn(), navigate: vi.fn() };

  it("shows evidence, edges and lineage, and runs actions", async () => {
    render(<NodePanel {...props} />);
    expect(await screen.findByText("Needing is unsafe", { selector: "h3" })).toBeTruthy();
    expect(screen.getByText("→ scaffolds → Dinner table")).toBeTruthy();
    expect(screen.getByText(/from “Dinner table”/)).toBeTruthy();
    fireEvent.click(screen.getByText("This fits"));
    fireEvent.click(screen.getByText("Not now (park)"));
    fireEvent.click(screen.getByText("Trace roots"));
    expect(await screen.findByText(/supports 1 downstream/)).toBeTruthy();
    fireEvent.click(screen.getByText("Related"));
    expect(await screen.findByText(/may be related/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByText("Rename"));
    fireEvent.change(screen.getByLabelText("Split into"), { target: { value: "A, B" } });
    fireEvent.click(screen.getByText("Split"));
    fireEvent.change(screen.getByLabelText("Merge with"), { target: { value: "n2" } });
    fireEvent.click(screen.getByText("Merge"));
    fireEvent.click(screen.getByText(/needing things is unsafe/));
    await waitFor(() => expect(posted.map((p) => p.url)).toEqual(["/api/items/n1/status", "/api/items/n1/status", "/api/items/n1/attributes", "/api/nodes/n1/split", "/api/merge"]));
    expect(props.onHighlight).toHaveBeenCalledWith(["n2", "n1"]);
    expect(props.navigate).toHaveBeenCalledWith("entries", "h@15-39");
    expect(screen.getByRole("button", { name: "Open “Tuesday” at this passage" })).toBeTruthy();
  });

  it("is read-only in the past and offers un-parking", async () => {
    routes["/api/nodes/n1"] = { ...nodeView, node: { ...graph.nodes.n1, status: "parked" }, outgoing: [], incoming: [], derivedFrom: [] };
    const { unmount } = render(<NodePanel {...props} readOnly />);
    expect(await screen.findByText("No edges.")).toBeTruthy();
    expect(screen.queryByText("Un-park")).toBeNull();
    unmount();
    render(<NodePanel {...props} />);
    fireEvent.click(await screen.findByText("Un-park"));
    routes["/api/nodes/n1"] = nodeView;
  });

  it("shows when a node is itself a root, and errors", async () => {
    routes["/api/nodes/n1/roots"] = { node: "n1", upstream: [], roots: [] };
    render(<NodePanel {...props} id="n1" />);
    fireEvent.click(await screen.findByText("Trace roots"));
    expect(await screen.findByText(/itself a root/)).toBeTruthy();
    cleanup();
    render(<NodePanel {...props} id="missing" />);
    expect(await screen.findByText("missing")).toBeTruthy();
  });
});

it("act is available for async effects", async () => {
  await act(async () => {});
});
