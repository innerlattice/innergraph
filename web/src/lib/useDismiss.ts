// Popovers and dialogs close when the person clicks anywhere outside them or presses Escape.
import { type RefObject, useEffect, useRef } from "react";

/** Calls `onDismiss` on a press outside `ref` or on Escape, while `open`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void, open = true): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const press = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) dismiss.current();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && dismiss.current();
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, [ref, open]);
}
