// Actions on Nodes/Edges shared by the item panels and the selection: confirm, remove, restore.
// Nothing waits for approval: every change lands at once and can be undone.
import { Check, type LucideIcon, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { IconButton } from "../components/IconButton";
import { ErrorNote } from "../components/ui";

export type ActionKind = "confirm" | "remove" | "restore";

export interface Done {
  kind: ActionKind;
  ids: string[];
}

const ACTIONS: Record<ActionKind, (ids: string[]) => Promise<unknown>> = {
  confirm: api.confirm,
  remove: api.remove,
  restore: (ids) => Promise.all(ids.map((id) => api.restore(id))),
};

const LABELS: Record<ActionKind, string> = { confirm: "Looks right", remove: "Remove", restore: "Restore" };
const ICONS: Record<ActionKind, LucideIcon> = { confirm: Check, remove: Trash2, restore: RotateCcw };
const HINTS: Record<ActionKind, string> = {
  confirm: "Mark as confirmed by you",
  remove: "Take it off the map (you can undo)",
  restore: "Put it back on the map as it was",
};

export interface ItemState {
  removed: boolean;
  confirmed: boolean;
}

/** What makes sense for a set of items: restore if all are removed; otherwise remove, and confirm while any is unconfirmed. */
export function kindsFor(items: ItemState[]): ActionKind[] {
  const active = items.filter((i) => !i.removed);
  if (items.length > 0 && active.length === 0) return ["restore"];
  return active.some((i) => !i.confirmed) ? ["confirm", "remove"] : ["remove"];
}

export function ItemActions(props: { ids: string[]; items: ItemState[]; onDone: (done: Done) => void; count?: boolean }) {
  const [error, setError] = useState<string>();
  const run = (kind: ActionKind) =>
    ACTIONS[kind](props.ids)
      .then(() => (setError(undefined), props.onDone({ kind, ids: props.ids })))
      .catch((e: Error) => setError(e.message));
  const many = props.count ? props.ids.length : undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {kindsFor(props.items).map((kind) => (
          <IconButton
            key={kind}
            label={many ? `${LABELS[kind]} (${many})` : LABELS[kind]}
            hint={HINTS[kind]}
            icon={ICONS[kind]}
            tone={kind === "remove" ? "quiet" : "primary"}
            badge={many}
            onClick={() => run(kind)}
          />
        ))}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** Shown after a removal so a mistake is one click away from being undone. */
export function UndoBar(props: { done?: Done; onUndo: () => void; onClose: () => void }) {
  if (props.done?.kind !== "remove") return null;
  const count = props.done.ids.length;
  return (
    <div
      role="status"
      className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full bg-stone-800 px-5 py-2 text-sm text-stone-50 shadow-floating"
    >
      <span>
        Removed {count} item{count === 1 ? "" : "s"}.
      </span>
      <button type="button" className="font-medium text-clay-200 hover:underline" onClick={props.onUndo}>
        Undo
      </button>
      <button type="button" aria-label="Dismiss" className="text-stone-400 hover:text-stone-100" onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}
