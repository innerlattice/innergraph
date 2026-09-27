// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Schema } from "../api";
import { GraphKey } from "./GraphKey";

afterEach(cleanup);

const schema = {
  name: "s",
  version: 1,
  nodeTypes: { belief: { attributes: {}, label: "statement", display: { shape: "rhomboid", color: "#123456" } }, person: { attributes: {} } },
  edgeTypes: {
    supports: { from: "*", to: "*", role: "derivational", attributes: {} },
    affects: { from: "*", to: "*", role: "causal", attributes: {} },
    member_of: { from: "*", to: "*", role: "identity", attributes: {} },
  },
} as Schema;

it("shows each kind of thing as its gem and only the link looks the schema uses", () => {
  const { container } = render(<GraphKey schema={schema} />);
  fireEvent.click(screen.getByRole("button", { name: "Key" }));
  expect(screen.getByText(/^belief$/i)).toBeTruthy();
  expect(container.querySelectorAll("img")).toHaveLength(2);
  for (const label of ["Builds on", "Increases", "Decreases", "Part of"]) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("Other link")).toBeNull();
  expect(screen.getByText("+")).toBeTruthy();
  expect(container.querySelector("svg line[stroke-dasharray='5 3']")).toBeTruthy();
});
