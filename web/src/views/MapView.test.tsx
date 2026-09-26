// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
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
const node = { attributes: {}, confidence: 0.5, evidence: [], assertedBy: "user", assertedAt: HLC1, updatedAt: HLC1, derivedFrom: [], type: "t", status: "active", confirmed: false, staleEvidence: 0 };
const nodes = { n1: { ...node, id: "n1", label: "One" }, n2: { ...node, id: "n2", label: "Two" }, p9: { ...node, id: "p9", label: "Ghost" } };
const now = { nodes, edges: {}, counts: { active: 3, removed: 1 }, position: HLC2 };
const past = { ...now, nodes: {}, counts: { active: 0, removed: 0 }, position: HLC1 };
const routes: Record<string, unknown> = {
  "/api/positions": [HLC1, HLC2],
  "/api/status": {
    model: "m",
    hosted: false,
    schema: { name: "s", version: 1, edgeTypes: {}, nodeTypes: { t: { attributes: {}, display: { shape: "round-rectangle", color: "#111111" } }, u: { attributes: {}, display: { shape: "barrel" } }, v: { attributes: {} } } },
  },
  "/api/view": now,
  "/api/duplicates": [],
  "/api/nodes/n1": { node: nodes.n1, evidence: [], outgoing: [], incoming: [], derivedFrom: [], derivedInto: [] },
  "/api/nodes/p9": { node: nodes.p9, evidence: [], outgoing: [], incoming: [], derivedFrom: [], derivedInto: [] },
  "/api/changes": [{ session: "s1", actor: "model:g", purpose: "ingest", at: HLC2, rows: [{ id: "p9", kind: "node", label: "Ghost", action: "added" }] }],
  "/api/selection": { ids: ["n1", "n2"], at: "", items: [{ id: "n1", kind: "node", type: "t", label: "One", status: "active", confirmed: true }, { id: "n2", kind: "node", type: "t", label: "Two", status: "active", confirmed: false }] },
  "/api/nodes/n1/roots": { node: "n1", upstream: ["n0"], roots: [{ id: "n0", support: 1, path: ["n0", "n1"] }] },
};
const respond = (url: string) => new Response(JSON.stringify(/[?&]t=/.test(url) ? past : (routes[url.split("?")[0]] ?? { ok: true })));

/** The shell owns the selection; this stands in for it. */
function Harness(props: { initial?: string[] }) {
  const [selection, setSelection] = useState(props.initial ?? []);
  return <MapView selection={selection} synced="" onSelect={setSelection} navigate={vi.fn()} />;
}

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) => respond(url));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("selects nodes, traces roots, and travels back in time", async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByText("node:n1"));
  expect(await screen.findByText("One", { selector: "h3" })).toBeTruthy();
  fireEvent.click(screen.getByText("Trace roots"));
  expect(await screen.findByText("highlight:n0,n1")).toBeTruthy();
  fireEvent.click(screen.getByText("Looks right"));
  fireEvent.click(screen.getByText("background"));
  expect(screen.queryByText("One", { selector: "h3" })).toBeNull();

  fireEvent.change(screen.getByLabelText("Time travel"), { target: { value: "0" } });
  expect(await screen.findByText(/Nothing on the map here yet/)).toBeTruthy();
  fireEvent.click(screen.getByText("Now"));
  await waitFor(() => expect(screen.queryByText(/Nothing to show/)).toBeNull());
  fireEvent.change(screen.getByLabelText("Time travel"), { target: { value: "1" } });
});

it("shows a selection panel for several items and clears it", async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByText("node:n1"));
  fireEvent.click(screen.getByText("node:n2"), { shiftKey: true });
  expect(await screen.findByText("2 selected")).toBeTruthy();
  expect(await screen.findByText("Two")).toBeTruthy();
  fireEvent.click(screen.getByText("Clear"));
  await waitFor(() => expect(screen.queryByText("2 selected")).toBeNull());
});

it("lists node types from the Schema in the legend", async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByText("Key"));
  expect(screen.getByText("t")).toBeTruthy();
  expect(screen.getByText("u")).toBeTruthy();
});

it("opens what changed from the status bar and shows removed items on request", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => (urls.push(url), respond(url)));
  render(<Harness />);
  fireEvent.click(await screen.findByText("What changed"));
  expect(await screen.findByText("New entry")).toBeTruthy();
  fireEvent.click(screen.getByText("Ghost"));
  expect(await screen.findByText("Ghost", { selector: "h3" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Show removed (1)"));
  await waitFor(() => expect(urls.some((u) => u.includes("statuses=active,removed"))).toBe(true));
});

it("drops selected items that leave the graph", async () => {
  routes["/api/view"] = { ...now, nodes: {} };
  render(<Harness initial={["n1"]} />);
  await waitFor(() => expect(screen.queryByText("One", { selector: "h3" })).toBeNull());
  routes["/api/view"] = now;
});

it("opens with a focused node", async () => {
  render(<Harness initial={["n1"]} />);
  expect(await screen.findByText("One", { selector: "h3" })).toBeTruthy();
});
