// Review building blocks shared by the item panels, the selection and the review queue.
import { useState } from "react";
import { type ItemChange, type ViewStatus, api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { actorLabel, describeEvent } from "../lib/format";

export type ReviewKind = "approve" | "decline" | "restore";

export interface Reviewed {
  kind: ReviewKind;
  ids: string[];
}

const ACTIONS: Record<ReviewKind, (ids: string[]) => Promise<unknown>> = {
  approve: api.approve,
  decline: api.decline,
  restore: (ids) => Promise.all(ids.map((id) => api.restore(id))),
};

const LABELS: Record<ReviewKind, string> = { approve: "Approve", decline: "Decline", restore: "Restore" };

/** Approve / Decline / Restore buttons for a set of Node, Edge or Event ids. */
export function ReviewActions(props: { ids: string[]; onDone: (done: Reviewed) => void; kinds?: ReviewKind[]; labels?: Partial<Record<ReviewKind, string>> }) {
  const [error, setError] = useState<string>();
  const kinds = props.kinds ?? ["approve", "decline"];
  const run = (kind: ReviewKind) =>
    ACTIONS[kind](props.ids)
      .then(() => (setError(undefined), props.onDone({ kind, ids: props.ids })))
      .catch((e: Error) => setError(e.message));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <Button key={kind} tone={kind === "decline" ? "quiet" : "primary"} onClick={() => run(kind)}>
            {props.labels?.[kind] ?? LABELS[kind]}
          </Button>
        ))}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** What each View status allows: one mapping, used everywhere. */
export const KINDS_BY_STATUS: Record<ViewStatus, ReviewKind[]> = {
  proposed: ["approve", "decline"],
  approved: ["decline"],
  parked: [],
  declined: ["restore"],
};

/** Actions that make sense for a set of items with these statuses. */
export function kindsFor(statuses: ViewStatus[]): ReviewKind[] {
  const unique = [...new Set(statuses)];
  if (unique.length === 1) return KINDS_BY_STATUS[unique[0]];
  return unique.includes("proposed") ? ["approve", "decline"] : ["decline"];
}

export function ItemActions(props: { id: string; status: ViewStatus; onDone: (done: Reviewed) => void }) {
  const kinds = KINDS_BY_STATUS[props.status];
  if (kinds.length === 0) return null;
  return <ReviewActions ids={[props.id]} kinds={kinds} onDone={props.onDone} />;
}

/** Waiting changes to an existing item (renames, retractions, refactors), each reviewable. */
export function PendingChanges(props: { changes: ItemChange[]; labels: Record<string, string>; onDone: (done: Reviewed) => void }) {
  if (props.changes.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 p-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-amber-800">Proposed changes</h4>
      {props.changes.map((c) => (
        <div key={c.event.id} className="space-y-1.5">
          <p className="text-sm text-stone-800">
            {describeEvent(c.event, props.labels)} <span className="text-xs text-stone-500">· by {actorLabel(c.event.actor)}</span>
          </p>
          {c.reasons.length > 0 ? <p className="text-xs text-amber-800">{c.reasons.join("; ")}</p> : null}
          <ReviewActions ids={[c.event.id]} onDone={props.onDone} labels={{ approve: "Accept change", decline: "Reject change" }} />
        </div>
      ))}
    </section>
  );
}

/** Shown after a decline so a mistake is one click away from being undone. */
export function UndoBar(props: { done?: Reviewed; onUndo: () => void; onClose: () => void }) {
  if (!props.done || props.done.kind !== "decline") return null;
  const count = props.done.ids.length;
  return (
    <div role="status" className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full bg-stone-800 px-5 py-2 text-sm text-stone-50 shadow-lg">
      <span>
        Declined {count} item{count === 1 ? "" : "s"}.
      </span>
      <button type="button" className="font-medium text-amber-300 hover:underline" onClick={props.onUndo}>
        Undo
      </button>
      <button type="button" aria-label="Dismiss" className="text-stone-400 hover:text-stone-100" onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}
