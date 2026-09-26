import type { Navigate } from "../App";
import { type ProposalView, api } from "../api";
import { ErrorNote, StatusPill } from "../components/ui";
import { humanise } from "../lib/elements";
import { actorLabel, entryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { EvidenceCard } from "./NodePanel";
import { ItemActions, PendingOnItem, type Reviewed } from "./ReviewControls";

type ProposalItem = ProposalView["items"][number];

function signText(sign: number | undefined): string {
  if (sign === -1) return " (decreases)";
  return sign === 1 ? " (increases)" : "";
}

export interface EdgePanelProps {
  id: string;
  labels: Record<string, string>;
  readOnly: boolean;
  version?: string;
  pending?: ProposalItem[];
  onReviewed: (done: Reviewed) => void;
  onSelect: (id: string) => void;
  navigate: Navigate;
}

/** One Edge: its endpoints, evidence and the review actions its status allows. */
export function EdgePanel(props: EdgePanelProps) {
  const view = useAsync(() => api.edge(props.id), [props.id, props.version]);
  if (!view.data) return <ErrorNote error={view.error} />;
  const { edge, fromLabel, toLabel, evidence } = view.data;
  const done = (d: Reviewed) => (view.reload(), props.onReviewed(d));
  return (
    <div className="space-y-5 p-5">
      <header className="space-y-1">
        <p className="text-xs text-stone-400">
          {humanise(edge.type)}
          {signText(edge.sign)} · {Math.round(edge.confidence * 100)}% · by {actorLabel(edge.assertedBy)}
        </p>
        <h3 className="font-serif text-xl text-stone-800">
          <button type="button" className="hover:underline" onClick={() => props.onSelect(edge.from)}>
            {fromLabel}
          </button>{" "}
          <span className="text-stone-400">→</span>{" "}
          <button type="button" className="hover:underline" onClick={() => props.onSelect(edge.to)}>
            {toLabel}
          </button>
        </h3>
        <StatusPill status={edge.status} />
      </header>
      {edge.status === "superseded" ? <p className="text-sm text-stone-500">Declined or retired. Restore brings it back as it was.</p> : null}
      {props.readOnly ? null : <ItemActions id={edge.id} status={edge.status} onDone={done} />}
      {props.readOnly ? null : <PendingOnItem items={props.pending ?? []} labels={props.labels} onDone={done} />}
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">Evidence</h4>
        {evidence.map((e) => (
          <EvidenceCard key={`${e.entry}-${e.start}`} evidence={e} onOpen={() => props.navigate("entries", entryFocus(e.entry, e.start, e.end))} />
        ))}
      </section>
    </div>
  );
}
