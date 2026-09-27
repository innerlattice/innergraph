// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExploreContext } from "../lib/explore";
import { ExploreButton, placeMenu } from "./ExploreButton";

afterEach(cleanup);

it("hides without anywhere to explore, and offers the activities that fit the item", () => {
  const { container } = render(<ExploreButton subject="loop" kind="Reinforcing loop" name="A → B → A" target="a,b" />);
  expect(container.innerHTML).toBe("");
  const explore = vi.fn();
  render(
    <ExploreContext.Provider value={explore}>
      <ExploreButton subject="loop" kind="Reinforcing loop" name="A → B → A" target="a,b" />
    </ExploreContext.Provider>,
  );
  fireEvent.click(screen.getByLabelText("Explore"));
  const menu = screen.getByRole("menu", { name: "Explore Reinforcing loop" });
  expect(menu.textContent).toContain("Reinforcing loop");
  expect(screen.getAllByRole("menuitem").map((b) => b.firstChild?.textContent)).toEqual(["Understand the dynamics", "Gather more info", "Five whys", "Find where it could ease"]);
  fireEvent.click(screen.getByText("Five whys"));
  expect(explore).toHaveBeenCalledWith({ subject: "loop", name: "A → B → A", target: "a,b", activity: "five_whys" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByLabelText("Explore"));
  fireEvent.pointerDown(screen.getByRole("menu"));
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("sits below its button, flush right, and above it when there's no room", () => {
  const view = { width: 800, height: 600 };
  expect(placeMenu({ top: 100, bottom: 132, right: 400 }, { width: 256, height: 200 }, view)).toEqual({ left: 144, top: 138 });
  expect(placeMenu({ top: 500, bottom: 532, right: 100 }, { width: 256, height: 200 }, view)).toEqual({ left: 8, top: 294 });
});
