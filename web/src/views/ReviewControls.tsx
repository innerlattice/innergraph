// In-graph review: counts and quick selection, Approve/Decline actions, and a panel for a
// single proposed (not yet merged) Node or Edge.
import { useState } from "react";
import { type Graph, type PendingItem, api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { humanise } from "../lib/elements";
import { actorLabel, spanText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function hypothesisIds(graph: Graph | undefined): string[] {
  const items = [...Object.values(graph?.nodes ?? {}), ...Object.values(graph?.edges ?? {})];
  return items.filter((i) => i.status === "hypothesis").map((i) => i.id);
}

export function ReviewBar(props: { proposed: PendingItem[]; graph?: Graph; onSelect: (ids: string[]) => void }) {
  const proposed = props.proposed.map((p) => p.item.id);
  const hypotheses = hypothesisIds(props.graph);
  if (proposed.length + hypotheses.length === 0) return null;
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50/70 px-5 py-1.5 text-xs text-amber-900">
      <span>
        {proposed.length} proposed · {hypotheses.length} hypotheses to confirm
      </span>
      <button type="button" disabled={proposed.length === 0} className="underline-offset-2 hover:underline disabled:opacity-40" onClick={() => props.onSelect(proposed)}>
        Select proposed
      </button>
      <button type="button" disabled={hypotheses.length === 0} className="underline-offset-2 hover:underline disabled:opacity-40" onClick={() => props.onSelect(hypotheses)}>
        Select hypotheses
      </button>
    </div>
  );
}

/** Approve / Decline for any mix of proposed items and merged hypotheses. */
export function ReviewActions(props: { ids: string[]; onDone: () => void; approveLabel?: string }) {
  const [error, setError] = useState<string>();
  const run = (action: (ids: string[]) => Promise<unknown>) =>
    action(props.ids)
      .then(() => (setError(undefined), props.onDone()))
      .catch((e: Error) => setError(e.message));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button tone="primary" onClick={() => run(api.approve)}>
          {props.approveLabel ?? "Approve"}
        </Button>
        <Button onClick={() => run(api.decline)}>Decline</Button>
      </div>
      <ErrorNote error={error} />
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

export function ProposedPanel(props: { item: PendingItem; labels: Record<string, string>; onDone: () => void }) {
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
