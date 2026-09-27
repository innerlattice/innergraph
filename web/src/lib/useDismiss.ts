// Popovers and dialogs close when the person clicks anywhere outside them or presses Escape.
import { type RefObject, useEffect, useRef } from "react";

type Ref = RefObject<HTMLElement | null>;

/** Calls `onDismiss` on a press outside `ref` (or all of several, for a menu and its button) or on Escape, while `open`. */
export function useDismiss(ref: Ref | Ref[], onDismiss: () => void, open = true): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const press = (e: PointerEvent) => {
      const inside = [ref].flat().some((r) => r.current?.contains(e.target as Node));
      if (!inside) dismiss.current();
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
