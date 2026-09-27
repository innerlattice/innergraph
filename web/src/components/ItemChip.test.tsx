// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GraphView } from "../api";
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
  expect(screen.getByText("enacts").parentElement?.textContent).toBe("The HiderenactsGo quiet");
  expect(screen.getByText("Forgotten")).toBeTruthy();
});
