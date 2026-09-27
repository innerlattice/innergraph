// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Schema } from "../api";
import { GraphKey } from "./GraphKey";

afterEach(cleanup);

const schema = {
  name: "s",
  version: 1,
  nodeTypes: {
    belief: { attributes: {}, label: "statement", display: { shape: "rhomboid", color: "#123456", group: "Beliefs" } },
    appraisal: { attributes: {}, display: { group: "Beliefs" } },
    person: { attributes: {}, description: "Someone in your life." },
  },
  edgeTypes: {
    supports: { from: "*", to: "*", role: "derivational", attributes: {} },
    affects: { from: "*", to: "*", role: "causal", attributes: {} },
    member_of: { from: "*", to: "*", role: "identity", attributes: {} },
  },
} as Schema;

it("shows each kind of thing as its gem, and each relation the schema has as the map draws it", () => {
  const { container } = render(<GraphKey schema={schema} />);
  fireEvent.click(screen.getByRole("button", { name: "Key" }));
  expect(screen.getByText(/^belief$/i)).toBeTruthy();
  expect(container.querySelectorAll("img")).toHaveLength(3);
  // Grouped kinds come first under their group; the rest follow under "Other kinds".
  expect([...container.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["Beliefs", "Other kinds", "Links", "States", "Moving around"]);
  for (const label of ["supports", "increases", "decreases", "member of"]) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("Builds on")).toBeNull();
  expect(screen.getByText("+")).toBeTruthy();
  expect(container.querySelector("svg line[stroke-dasharray='5 3']")).toBeTruthy();
});

it("says what a kind or a link means on hover", async () => {
  render(<GraphKey schema={schema} />);
  fireEvent.click(screen.getByRole("button", { name: "Key" }));
  fireEvent.mouseEnter(screen.getByText(/^person$/i));
  expect(await screen.findByText("Someone in your life.")).toBeTruthy();
  fireEvent.mouseEnter(screen.getByText("decreases"));
  expect(await screen.findByText(/weaker, or calms it down/)).toBeTruthy();
});

it("puts every kind under one heading when the schema has no groups", () => {
  render(<GraphKey schema={{ ...schema, nodeTypes: { person: { attributes: {} } } } as Schema} />);
  fireEvent.click(screen.getByRole("button", { name: "Key" }));
  expect(screen.getByText("Kinds of thing")).toBeTruthy();
});

it("closes on a click outside it", () => {
  render(<GraphKey schema={schema} />);
  fireEvent.click(screen.getByRole("button", { name: "Key" }));
  fireEvent.pointerDown(screen.getByText("Links"));
  expect(screen.getByText("Hide key")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.getByText("Key")).toBeTruthy();
});
