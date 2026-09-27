// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { edgeText, parseEdgeText } from "../../../src/core/edgeText";
import { Chip, EdgeLabel, ItemLabel } from "./Chip";

afterEach(cleanup);

it("writes and reads edges one way", () => {
  expect(edgeText("A", "held_by", "B")).toBe("A —held_by→ B");
  expect(parseEdgeText("A —held_by→ B")).toEqual({ from: "A", verb: "held by", to: "B" });
  expect(parseEdgeText("Just a node")).toBeUndefined();
});

it("renders edges with the ends forward and the verb quiet", () => {
  render(<ItemLabel label="The Hider —enacts→ Go quiet" />);
  const verb = screen.getByText("enacts");
  expect(verb.className).toContain("italic");
  expect(verb.parentElement?.textContent).toBe("The HiderenactsGo quiet");
  render(<ItemLabel label="Plain" />);
  expect(screen.getByText("Plain")).toBeTruthy();
  const { container } = render(<EdgeLabel verb="protects" />);
  expect(container.textContent).toBe("protects");
});

it("chips act, remove, carry their tone, and go inert when struck", () => {
  const onClick = vi.fn();
  const onRemove = vi.fn();
  render(
    <>
      <Chip onClick={onClick}>open</Chip>
      <Chip tone="context" onClick={onClick} onRemove={onRemove} removeLabel="Unselect B">
        B
      </Chip>
      <Chip onRemove={onRemove}>unnamed</Chip>
      <Chip struck onClick={onClick}>
        gone
      </Chip>
      <Chip tone="accent">static</Chip>
    </>,
  );
  fireEvent.click(screen.getByText("open"));
  fireEvent.click(screen.getByText("gone"));
  fireEvent.click(screen.getByLabelText("Unselect B"));
  fireEvent.click(screen.getByLabelText("Remove"));
  expect([onClick.mock.calls.length, onRemove.mock.calls.length]).toEqual([1, 2]);
  expect(screen.getByText("B").closest("[data-tone]")?.getAttribute("data-tone")).toBe("context");
  expect((screen.getByText("static").closest("button") as HTMLButtonElement).disabled).toBe(true);
});
