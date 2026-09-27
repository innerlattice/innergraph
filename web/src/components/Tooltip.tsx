// A small explanation that appears while the pointer rests on (or keyboard focus reaches) the
// thing it explains. It sits above its anchor, flips below when there's no room, and slides
// sideways to stay inside the window.
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOLTIP } from "../design/tokens";

interface Rect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/** Where a tip of this size goes for an anchor at `anchor`, inside a window `view` wide and tall. */
export function placeTip(anchor: Rect, tip: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const { offset, margin } = TOOLTIP;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(margin, Math.min(centred, view.width - margin - tip.width));
  const above = anchor.top - offset - tip.height;
  const top = above >= margin ? above : Math.min(anchor.bottom + offset, view.height - margin - tip.height);
  return { left, top };
}

export function Tooltip(props: { content: ReactNode; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    setAt(placeTip(anchor.current.getBoundingClientRect(), tip.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);
  const show = () => setOpen(true);
  const hide = () => (setOpen(false), setAt(undefined));
  return (
    // An empty title hides any native tooltip from an enclosing element while this one shows.
    <span ref={anchor} title="" className="inline-flex shrink-0" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {props.children}
      {open
        ? createPortal(
            <div
              ref={tip}
              role="tooltip"
              className={`pointer-events-none fixed z-50 max-w-64 rounded-lg bg-stone-800 px-2.5 py-1.5 text-left text-caption leading-snug font-normal not-italic text-stone-50 shadow-floating ${at ? "" : "invisible"}`}
              style={at ?? { left: 0, top: 0 }}
            >
              {props.content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/** A tooltip's usual body: a name, and what it means when there's more to say. */
export function TipBody(props: { title: ReactNode; text?: string }) {
  return (
    <>
      <span className="block font-medium">{props.title}</span>
      {props.text ? <span className="mt-0.5 block text-stone-300">{props.text}</span> : null}
    </>
  );
}
