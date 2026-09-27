// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GraphView, Schema } from "../api";
import { ItemsProvider } from "../lib/items";
import { ItemChip } from "./ItemChip";

afterEach(cleanup);

const view = {
  nodes: { a: { id: "a", type: "part", label: "The Hider" }, b: { id: "b", type: "behavior", label: "Go quiet" } },
  edges: { e: { id: "e", type: "enacts", from: "a", to: "b" } },
} as unknown as GraphView;

it("names items as the live map does, whatever label it was given", () => {
  const onClick = vi.fn();
  render(
    <ItemsProvider value={{ view, schema: null }}>
      <ItemChip id="a" label="Old name" onClick={onClick} />
      <ItemChip id="e" />
      <ItemChip id="gone" label="Forgotten" />
    </ItemsProvider>,
  );
  const node = screen.getByTitle("The Hider");
  fireEvent.click(node);
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.queryByText("Old name")).toBeNull();
  expect(node.querySelector("img")).toBeTruthy();
  expect(screen.getByTitle("The Hider enacts Go quiet").textContent).toBe("The HiderenactsGo quiet");
  expect(screen.getByText("Forgotten")).toBeTruthy();
});

const schema = {
  name: "s",
  version: 1,
  nodeTypes: { part: { description: "A partition of inference.", attributes: {} } },
  edgeTypes: { reinforces: { description: "A raises or lowers B.", from: "*", to: "*", role: "causal", attributes: {} } },
} as unknown as Schema;

it("says what a causal link does, and explains link and node types on hover", () => {
  const causal = {
    nodes: view.nodes,
    edges: { up: { id: "up", type: "reinforces", sign: 1, from: "a", to: "b" }, down: { id: "down", type: "reinforces", sign: -1, from: "b", to: "a" } },
  } as unknown as GraphView;
  render(
    <ItemsProvider value={{ view: causal, schema }}>
      <ItemChip id="up" />
      <ItemChip id="down" />
      <ItemChip id="a" />
    </ItemsProvider>,
  );
  expect(screen.getByTitle("The Hider increases Go quiet")).toBeTruthy();
  fireEvent.mouseEnter(screen.getByText("decreases"));
  expect(screen.getByRole("tooltip").textContent).toBe("Decreases (reinforces)A raises or lowers B.");
  fireEvent.mouseLeave(screen.getByText("decreases"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.mouseEnter(screen.getByTitle("The Hider").querySelector("img") as Element);
  expect(screen.getByRole("tooltip").textContent).toBe("partA partition of inference.");
});
