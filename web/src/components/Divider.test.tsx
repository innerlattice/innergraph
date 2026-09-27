// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_WIDTH, Divider, clampShare, usePaneWidth } from "./Divider";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("keeps both sides usable", () => {
  expect(clampShare(0.5, 1000)).toBe(0.5);
  expect(clampShare(0.01, 1000)).toBe(0.32);
  expect(clampShare(0.99, 1000)).toBe(0.64);
  expect(clampShare(0.3, 500)).toBe(DEFAULT_WIDTH);
});

it("resizes by dragging, arrow keys and double-click, and remembers the width", () => {
  const onChange = vi.fn();
  render(<Divider share={0.5} onChange={onChange} />);
  const handle = screen.getByRole("separator");
  fireEvent.pointerMove(handle, { clientX: 300 });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 400 });
  fireEvent.pointerUp(handle);
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.keyDown(handle, { key: "Enter" });
  fireEvent.doubleClick(handle);
  expect(onChange.mock.calls.map((c) => Number(c[0].toFixed(2)))).toEqual([Number(((window.innerWidth - 48 - 400) / (window.innerWidth - 104)).toFixed(2)), 0.53, 0.47, DEFAULT_WIDTH]);

  const { result } = renderHook(() => usePaneWidth());
  expect(result.current.share).toBe(DEFAULT_WIDTH);
  act(() => result.current.set(0.5));
  expect(localStorage.getItem("inner-graph:pane-width")).toBe("0.5");
  expect(renderHook(() => usePaneWidth()).result.current.share).toBe(0.5);
});

it("works without storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { result } = renderHook(() => usePaneWidth());
  expect(result.current.share).toBe(DEFAULT_WIDTH);
  act(() => result.current.set(0.5));
  expect(result.current.share).toBe(0.5);
});
