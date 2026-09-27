// The Explore button: wherever it sits, it says "you can explore this with the assistant". It
// opens a small menu of the activities that fit the item, headed by what kind of item it is.
import { Compass } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type ActivityRequest, activitiesFor } from "../../../src/core/activities";
import { TOOLTIP } from "../design/tokens";
import { useExplore } from "../lib/explore";
import { useDismiss } from "../lib/useDismiss";
import { IconButton } from "./IconButton";

interface Box {
  top: number;
  bottom: number;
  right: number;
}

/** Below the button and flush with its right edge; above it when there's no room below. */
export function placeMenu(anchor: Box, menu: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const { offset, margin } = TOOLTIP;
  const left = Math.max(margin, Math.min(anchor.right - menu.width, view.width - margin - menu.width));
  const below = anchor.bottom + offset;
  const top = below + menu.height <= view.height - margin ? below : Math.max(margin, anchor.top - offset - menu.height);
  return { left, top };
}

export function ExploreButton(props: Omit<ActivityRequest, "activity"> & { kind: string }) {
  const explore = useExplore();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number }>();
  const button = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss([button, menu], () => setOpen(false), open);
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) {
      setAt(undefined);
      return;
    }
    setAt(placeMenu(button.current.getBoundingClientRect(), menu.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);
  if (!explore) return null;
  const { kind, ...item } = props;
  return (
    <span ref={button} className="inline-flex">
      <IconButton label="Explore" hint="Explore this with the assistant" icon={Compass} pressed={open} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={`Explore ${kind}`}
              className={`fixed z-50 w-64 rounded-xl bg-white p-1.5 shadow-floating ${at ? "" : "invisible"}`}
              style={at ?? { left: 0, top: 0 }}
            >
              <p className="px-2.5 pt-1 pb-1.5 text-xs font-medium uppercase tracking-wide text-stone-400">{kind}</p>
              {activitiesFor(props.subject).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left transition hover:bg-clay-50"
                  onClick={() => (setOpen(false), explore({ ...item, activity: a.id }))}
                >
                  <span className="block text-sm text-stone-800">{a.label}</span>
                  <span className="block text-xs text-stone-500">{a.description}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
