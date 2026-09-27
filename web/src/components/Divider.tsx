// The handle between the conversation and the view beside it: drag (or use the arrow keys) to
// share the window differently; double-click to go back to the default. The width is kept per
// browser, as a convenience only.
import { type KeyboardEvent, type PointerEvent, useState } from "react";

const KEY = "inner-graph:pane-width";
export const DEFAULT_WIDTH = 0.56;
/** The view never gets narrower than this, nor the chat narrower than CHAT_MIN. */
const PANE_MIN = 320;
const CHAT_MIN = 360;
/** The two rails, which sit outside the shared space. */
const RAILS = 56 + 48;

function stored(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return value > 0 && value < 1 ? value : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function store(value: number): void {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    // Private windows may refuse storage; the width then lasts for this visit only.
  }
}

/** The view's share of the space between the rails, kept within sensible bounds. */
export function clampShare(share: number, space: number): number {
  if (space <= PANE_MIN + CHAT_MIN) return DEFAULT_WIDTH;
  return Math.min(Math.max(share, PANE_MIN / space), 1 - CHAT_MIN / space);
}

export function usePaneWidth() {
  const [share, setShare] = useState(stored);
  const set = (next: number) => {
    const clamped = clampShare(next, window.innerWidth - RAILS);
    setShare(clamped);
    store(clamped);
  };
  return { share, set };
}

export function Divider(props: { share: number; onChange: (share: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const space = () => window.innerWidth - RAILS;
  const shareAt = (x: number) => (window.innerWidth - 48 - x) / space();
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => dragging && props.onChange(shareAt(e.clientX));
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? 0.03 : e.key === "ArrowRight" ? -0.03 : 0;
    if (step) props.onChange(props.share + step);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, draggable separator has no native element
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the conversation"
      aria-valuenow={Math.round((1 - props.share) * 100)}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => setDragging(false)}
      onDoubleClick={() => props.onChange(DEFAULT_WIDTH)}
      onKeyDown={key}
      title="Drag to resize. Double-click to reset."
      className="group relative z-30 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none"
    >
      <span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${dragging ? "bg-clay-400" : "bg-stone-200 group-hover:bg-clay-300 group-focus-visible:bg-clay-400"}`} />
    </div>
  );
}
