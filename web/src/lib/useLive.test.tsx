// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLive } from "./useLive";

class FakeSource {
  static last: FakeSource;
  listeners: ((e: { data: string }) => void)[] = [];
  closed = false;
  constructor(public url: string) {
    FakeSource.last = this;
  }
  addEventListener(_: string, fn: (e: { data: string }) => void) {
    this.listeners.push(fn);
  }
  emit(data: string) {
    for (const fn of this.listeners) fn({ data });
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe(props: { onChange: (p: string) => void }) {
  useLive(props.onChange);
  return null;
}

it("ignores the initial position and reports later ones", () => {
  vi.stubGlobal("EventSource", FakeSource);
  const onChange = vi.fn();
  const { unmount } = render(<Probe onChange={onChange} />);
  FakeSource.last.emit("p1");
  FakeSource.last.emit("p2");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("p2");
  unmount();
  expect(FakeSource.last.closed).toBe(true);
});

it("does nothing without EventSource", () => {
  vi.stubGlobal("EventSource", undefined);
  render(<Probe onChange={vi.fn()} />);
});
