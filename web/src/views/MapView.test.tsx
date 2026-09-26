// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GraphCanvasProps } from "../components/GraphCanvas";
import { MapView } from "./MapView";

// Cytoscape needs a real canvas; stand in with buttons that report selection and highlight.
vi.mock("../components/GraphCanvas", () => ({
  GraphCanvas: (props: GraphCanvasProps) => (
    <div>
      {props.elements.map((e) => (
        <button type="button" key={String(e.data.id)} onClick={(ev) => props.onSelectionChange(ev.shiftKey ? [...props.selection, String(e.data.id)] : [String(e.data.id)])}>
          node:{String(e.data.id)}
        </button>
      ))}
      <button type="button" onClick={() => props.onSelectionChange([])}>background</button>
      <p>highlight:{(props.highlight ?? []).join(",")}</p>
    </div>
  ),
}));

const HLC1 = "001758800000000.000000.d";
const HLC2 = "001758800001000.000000.d";
const node = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "user", assertedAt: HLC1, updatedAt: HLC1, derivedFrom: [], type: "t", status: "accepted" };
const now = { nodes: { n1: { ...node, id: "n1", label: "One" }, n2: { ...node, id: "n2", label: "Two" } }, edges: {} };
const routes: Record<string, unknown> = {
  "/api/positions": [HLC1, HLC2],
  "/api/status": {
    model: "m",
    hosted: false,
    schema: { name: "s", version: 1, edgeTypes: {}, nodeTypes: { t: { attributes: {}, display: { shape: "round-rectangle", color: "#111111" } }, u: { attributes: {}, display: { shape: "barrel" } }, v: { attributes: {} } } },
  },
  "/api/graph": now,
  "/api/graph/at": { position: HLC1, graph: { nodes: {}, edges: {} } },
  "/api/nodes/n1": { node: now.nodes.n1, evidence: [], outgoing: [], incoming: [], derivedFrom: [], derivedInto: [] },
  "/api/selection": { ids: ["n1", "n2"], at: "", items: [{ id: "n1", kind: "node", type: "t", label: "One", status: "accepted" }, { id: "n2", kind: "node", type: "t", label: "Two", status: "hypothesis" }] },
  "/api/nodes/n1/roots": { node: "n1", upstream: ["n0"], roots: [{ id: "n0", support: 1, path: ["n0", "n1"] }] },
};

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(routes[url.split("?")[0]] ?? { ok: true })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("selects nodes, traces roots, and travels back in time", async () => {
  render(<MapView navigate={vi.fn()} />);
  fireEvent.click(await screen.findByText("node:n1"));
  expect(await screen.findByText("One", { selector: "h3" })).toBeTruthy();
  fireEvent.click(screen.getByText("Trace roots"));
  expect(await screen.findByText("highlight:n0,n1")).toBeTruthy();
  fireEvent.click(screen.getByText("Not now (park)"));
  fireEvent.click(screen.getByText("background"));
  expect(screen.queryByText("One", { selector: "h3" })).toBeNull();

  fireEvent.change(screen.getByLabelText("Time travel"), { target: { value: "0" } });
  expect(await screen.findByText(/The map is empty at this point/)).toBeTruthy();
  fireEvent.click(screen.getByText("Now"));
  await waitFor(() => expect(screen.queryByText(/The map is empty/)).toBeNull());
  fireEvent.change(screen.getByLabelText("Time travel"), { target: { value: "1" } });
});

it("shows a selection panel for several items and syncs the selection", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method) calls.push(`${init.method} ${url}`);
    return new Response(JSON.stringify(routes[url.split("?")[0]] ?? { ok: true }));
  });
  render(<MapView navigate={vi.fn()} />);
  fireEvent.click(await screen.findByText("node:n1"));
  fireEvent.click(screen.getByText("node:n2"), { shiftKey: true });
  expect(await screen.findByText("2 selected")).toBeTruthy();
  expect(await screen.findByText("Two")).toBeTruthy();
  fireEvent.click(screen.getByText("Clear"));
  await waitFor(() => expect(calls.filter((c) => c.startsWith("PUT /api/selection"))).toHaveLength(3));
});

it("lists node types from the Schema in the legend", async () => {
  render(<MapView navigate={vi.fn()} />);
  expect(await screen.findByText("t")).toBeTruthy();
  expect(screen.getByText("u")).toBeTruthy();
});

it("opens with a focused node", async () => {
  render(<MapView focus="n1" navigate={vi.fn()} />);
  expect(await screen.findByText("One", { selector: "h3" })).toBeTruthy();
});
