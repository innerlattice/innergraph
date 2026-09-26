// In-graph review: counts and quick selection, Approve/Decline actions, and a panel for a
// single proposed (not yet merged) Node or Edge.
import { useState } from "react";
import { type Graph, type PendingChanges, type PendingItem, type ProposalView, api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { humanise } from "../lib/elements";
import { actorLabel, describeEvent, spanText } from "../lib/format";

type ProposalItem = ProposalView["items"][number];
import { useAsync } from "../lib/useAsync";

export function hypothesisIds(graph: Graph | undefined): string[] {
  const items = [...Object.values(graph?.nodes ?? {}), ...Object.values(graph?.edges ?? {})];
  return items.filter((i) => i.status === "hypothesis").map((i) => i.id);
}

function otherTargets(pending: PendingChanges | undefined): string[] {
  return (pending?.other ?? []).flatMap((i) => {
    const b = i.event.body as { target?: string; source?: string; sources?: string[] };
    return [b.target, b.source, ...(b.sources ?? [])].filter((x): x is string => Boolean(x));
  });
}

export function ReviewBar(props: { proposed: PendingItem[]; pending?: PendingChanges; graph?: Graph; onSelect: (ids: string[]) => void }) {
  const proposed = props.proposed.map((p) => p.item.id);
  const hypotheses = hypothesisIds(props.graph);
  const changed = [...new Set(otherTargets(props.pending))];
  if (proposed.length + hypotheses.length + changed.length === 0) return null;
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50/70 px-5 py-1.5 text-xs text-amber-900">
      <span>
        {proposed.length} proposed · {changed.length} with proposed changes · {hypotheses.length} hypotheses to confirm
      </span>
      {changed.length > 0 ? (
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => props.onSelect(changed)}>
          Select changed
        </button>
      ) : null}
      <button type="button" disabled={proposed.length === 0} className="underline-offset-2 hover:underline disabled:opacity-40" onClick={() => props.onSelect(proposed)}>
        Select proposed
      </button>
      <button type="button" disabled={hypotheses.length === 0} className="underline-offset-2 hover:underline disabled:opacity-40" onClick={() => props.onSelect(hypotheses)}>
        Select hypotheses
      </button>
    </div>
  );
}

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

/** Approve / Decline / Restore buttons; which ones show depends on the items' status. */
export function ReviewActions(props: { ids: string[]; onDone: (done: Reviewed) => void; approveLabel?: string; kinds?: ReviewKind[] }) {
  const [error, setError] = useState<string>();
  const kinds = props.kinds ?? ["approve", "decline"];
  const run = (kind: ReviewKind) =>
    ACTIONS[kind](props.ids)
      .then(() => (setError(undefined), props.onDone({ kind, ids: props.ids })))
      .catch((e: Error) => setError(e.message));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {kinds.map((kind) => (
          <Button key={kind} tone={kind === "decline" ? "quiet" : "primary"} onClick={() => run(kind)}>
            {kind === "approve" ? (props.approveLabel ?? LABELS.approve) : LABELS[kind]}
          </Button>
        ))}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

const KINDS_BY_STATUS: Record<string, ReviewKind[]> = {
  hypothesis: ["approve", "decline"],
  accepted: ["decline"],
  superseded: ["restore"],
  proposed: ["approve", "decline"],
};

/** The review actions that make sense for one item in its current status. */
export function ItemActions(props: { id: string; status: string; onDone: (done: Reviewed) => void }) {
  const kinds = KINDS_BY_STATUS[props.status];
  if (!kinds) return null;
  return <ReviewActions ids={[props.id]} kinds={kinds} onDone={props.onDone} />;
}

function touches(item: ProposalItem, id: string): boolean {
  const b = item.event.body as { target?: string; source?: string; sources?: string[] };
  return b.target === id || b.source === id || (b.sources ?? []).includes(id);
}

export function pendingFor(pending: PendingChanges | undefined, id: string): ProposalItem[] {
  return (pending?.other ?? []).filter((i) => touches(i, id));
}

/** Waiting changes to an existing item (renames, status changes, refactors), each reviewable. */
export function PendingOnItem(props: { items: ProposalItem[]; labels: Record<string, string>; onDone: (done: Reviewed) => void }) {
  if (props.items.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 p-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-amber-800">Waiting for your review</h4>
      {props.items.map((i) => (
        <div key={i.event.id} className="space-y-1.5">
          <p className="text-sm text-stone-800">
            {describeEvent(i.event, props.labels)} <span className="text-xs text-stone-500">· by {actorLabel(i.event.actor)}</span>
          </p>
          {i.reasons.length > 0 ? <p className="text-xs text-amber-800">{i.reasons.join("; ")}</p> : null}
          <ReviewActions ids={[i.event.id]} onDone={props.onDone} />
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

function ProposedEvidence(props: { item: PendingItem }) {
  const evidence = props.item.item.evidence;
  const entry = useAsync(() => (evidence[0] ? api.entry(evidence[0].entry) : Promise.resolve(undefined)), [props.item.eventId]);
  return (
    <ul className="space-y-2">
      {evidence.map((e) => (
        <li key={`${e.start}-${e.end}`} className="rounded-lg border border-stone-200 bg-stone-50 p-3 font-serif text-sm text-stone-700">
          “{entry.data ? spanText(entry.data.text, e.start, e.end) : "…"}”
        </li>
      ))}
    </ul>
  );
}

export function ProposedPanel(props: { item: PendingItem; labels: Record<string, string>; onDone: (done: Reviewed) => void }) {
  const { item, labels } = props;
  const body = item.item;
  const title = "label" in body ? body.label : `${labels[body.from] ?? body.from} —${humanise(body.type)}→ ${labels[body.to] ?? body.to}`;
  return (
    <div className="space-y-5 p-5">
      <header className="space-y-1">
        <p className="text-xs text-stone-400">
          {humanise(body.type)} · {Math.round(body.confidence * 100)}% · proposed by {actorLabel(body.assertedBy)}
        </p>
        <h3 className="font-serif text-xl text-stone-800">{title}</h3>
        <span className="rounded-full border border-dashed border-amber-500 px-2 py-0.5 text-xs text-amber-800">proposed</span>
      </header>
      {item.reasons.length > 0 ? <p className="text-sm text-amber-800">Waiting for your review: {item.reasons.join("; ")}.</p> : null}
      <ReviewActions ids={[body.id]} onDone={props.onDone} />
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">Evidence</h4>
        <ProposedEvidence item={item} />
      </section>
    </div>
  );
}
