import { useState } from "react";
import type { Navigate } from "../App";
import { type NodeView, type RelatedItem, type RootTrace, type ViewStatus, api } from "../api";
import { Button, ErrorNote, StatusPill } from "../components/ui";
import { actorLabel, entryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { ItemActions, PendingChanges, type Reviewed } from "./ReviewControls";
import { Related } from "./WriteView";

export interface NodePanelProps {
  id: string;
  labels: Record<string, string>;
  readOnly: boolean;
  onChanged: () => void;
  onHighlight: (ids: string[]) => void;
  navigate: Navigate;
  /** Changes when the Log moves, so the panel refreshes live. */
  version?: string;
  /** Which statuses the map shows; the edge list follows the same filter. */
  statuses?: ViewStatus[];
  onReviewed?: (done: Reviewed) => void;
  onSelect?: (id: string) => void;
}

type Run = (work: () => Promise<unknown>) => void;

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">{props.title}</h4>
      {props.children}
    </section>
  );
}

export function StaleNote(props: { count: number }) {
  if (props.count === 0) return null;
  return <p className="text-xs text-stone-400">{props.count === 1 ? "1 passage" : `${props.count} passages`} from an earlier version of the entry hidden.</p>;
}

export function EvidenceCard(props: { evidence: NodeView["evidence"][number]; onOpen: () => void }) {
  const { evidence: e, onOpen } = props;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open “${e.entryTitle}” at this passage`}
      className="group block w-full rounded-lg border border-stone-200 bg-stone-50 p-3 text-left transition hover:border-stone-400 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
    >
      <p className="font-serif text-sm leading-relaxed text-stone-500">
        {e.before ? "…" : ""}
        {e.before}
        <mark className="rounded bg-amber-100 px-0.5 text-stone-900">{e.text}</mark>
        {e.after}
        {e.after ? "…" : ""}
      </p>
      <p className="mt-2 flex items-center justify-between text-xs text-stone-400">
        <span className="truncate">{e.entryTitle}</span>
        <span className="shrink-0 text-stone-500 underline-offset-2 group-hover:underline" aria-hidden="true">
          Open in entry →
        </span>
      </p>
    </button>
  );
}

function EdgeList(props: { view: NodeView; labels: Record<string, string>; onSelect?: (id: string) => void }) {
  const { view, labels } = props;
  const rows = [
    ...view.outgoing.map((e) => ({ id: e.id, status: e.status, text: `→ ${e.type} → ${labels[e.to] ?? e.to}` })),
    ...view.incoming.map((e) => ({ id: e.id, status: e.status, text: `← ${e.type} ← ${labels[e.from] ?? e.from}` })),
  ];
  if (rows.length === 0) return <p className="text-sm text-stone-400">No edges.</p>;
  return (
    <ul className="space-y-1 text-sm text-stone-600">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className={`text-left hover:underline ${r.status === "declined" ? "text-stone-400 line-through" : ""}`} onClick={() => props.onSelect?.(r.id)}>
            {r.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

const STATUS_NOTE: Partial<Record<ViewStatus, string>> = {
  declined: "Declined. Restore brings it back as it was.",
  parked: "Parked: set aside, and never brought up by suggestions or recall.",
};

function StatusActions(props: { view: NodeView; run: Run; onDone: (done: Reviewed) => void }) {
  const { node } = props.view;
  const set = (status: "parked" | "hypothesis") => props.run(() => api.setStatus(node.id, status));
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ItemActions id={node.id} status={node.status} onDone={props.onDone} />
      {node.status === "parked" ? <Button onClick={() => set("hypothesis")}>Un-park</Button> : null}
      {node.status === "proposed" || node.status === "approved" ? <Button onClick={() => set("parked")}>Not now (park)</Button> : null}
    </div>
  );
}

function ReviewSection(props: { view: NodeView; readOnly: boolean; run: Run; labels: Record<string, string>; onDone: (done: Reviewed) => void }) {
  const { node, reasons, changes } = props.view;
  return (
    <>
      {STATUS_NOTE[node.status] ? <p className="text-sm text-stone-500">{STATUS_NOTE[node.status]}</p> : null}
      {node.held ? <p className="text-sm text-amber-800">Not on the map until you approve it: {reasons.join("; ") || "high-impact change"}.</p> : null}
      {props.readOnly ? null : <StatusActions view={props.view} run={props.run} onDone={props.onDone} />}
      {props.readOnly ? null : <PendingChanges changes={changes} labels={props.labels} onDone={props.onDone} />}
    </>
  );
}

/** A title that becomes an input on double-click; Enter saves, Escape cancels. */
export function EditableTitle(props: { value: string; readOnly: boolean; onSave: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const save = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== props.value) props.onSave(draft.trim());
  };
  if (!editing || props.readOnly) {
    return (
      <h3 className="font-serif text-xl text-stone-800" title={props.readOnly ? undefined : "Double-click to rename"} onDoubleClick={() => (setDraft(props.value), setEditing(true))}>
        {props.value}
      </h3>
    );
  }
  return (
    <input
      aria-label="Rename"
      className="w-full rounded-md border border-stone-300 px-2 py-1 font-serif text-xl text-stone-800 outline-none focus:border-stone-500"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => (e.key === "Enter" ? save() : e.key === "Escape" && setEditing(false))}
    />
  );
}

function RefactorTools(props: { view: NodeView; labels: Record<string, string>; run: Run }) {
  const { view, labels, run } = props;
  const [parts, setParts] = useState("");
  const [mergeWith, setMergeWith] = useState("");
  const others = Object.entries(labels).filter(([id]) => id !== view.node.id);
  const splitLabels = parts.split(",").map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2">
        <input aria-label="Split into" className="min-w-0 flex-1 rounded-md border border-stone-200 px-2" placeholder="Split into: label A, label B" value={parts} onChange={(e) => setParts(e.target.value)} />
        <Button disabled={splitLabels.length < 2} onClick={() => run(() => api.split(view.node.id, splitLabels))}>Split</Button>
      </div>
      <div className="flex gap-2">
        <select aria-label="Merge with" className="min-w-0 flex-1 rounded-md border border-stone-200 px-2" value={mergeWith} onChange={(e) => setMergeWith(e.target.value)}>
          <option value="">Merge with…</option>
          {others.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <Button disabled={!mergeWith} onClick={() => run(() => api.merge([view.node.id, mergeWith], view.node.label))}>Merge</Button>
      </div>
    </div>
  );
}

function RootsList(props: { trace?: RootTrace; labels: Record<string, string> }) {
  if (!props.trace) return null;
  if (props.trace.roots.length === 0) return <p className="text-sm text-stone-500">No upstream roots: this node is itself a root.</p>;
  return (
    <ol className="space-y-1 text-sm text-stone-600">
      {props.trace.roots.map((r) => (
        <li key={r.id}>
          <span className="font-medium text-stone-800">{props.labels[r.id] ?? r.id}</span> supports {r.support} downstream · via {r.path.map((p) => props.labels[p] ?? p).join(" → ")}
        </li>
      ))}
    </ol>
  );
}

export function NodePanel(props: NodePanelProps) {
  const { id, labels, readOnly, onChanged, onHighlight, navigate, version } = props;
  const view = useAsync(() => api.node(id, props.statuses), [id, version, props.statuses?.join()]);
  const [trace, setTrace] = useState<RootTrace>();
  const [related, setRelated] = useState<RelatedItem[]>();
  const [error, setError] = useState<string>();
  const run: Run = (work) => {
    setError(undefined);
    work().then(() => (view.reload(), onChanged())).catch((e: Error) => setError(e.message));
  };
  const traceRoots = () => api.roots(id).then((t) => (setTrace(t), onHighlight([...t.upstream, id]))).catch((e: Error) => setError(e.message));

  if (!view.data) return <ErrorNote error={view.error} />;
  const { node } = view.data;
  return (
    <div className="space-y-5 p-5">
      <header className="space-y-1">
        <p className="text-xs text-stone-400">{node.type.replace(/_/g, " ")} · {Math.round(node.confidence * 100)}% · by {actorLabel(node.assertedBy)}</p>
        <EditableTitle value={node.label} readOnly={readOnly} onSave={(label) => run(() => api.rename(node.id, label))} />
        <StatusPill status={node.status} />
      </header>
      <ErrorNote error={error} />
      <ReviewSection view={view.data} readOnly={readOnly} run={run} labels={labels} onDone={(done) => (view.reload(), onChanged(), props.onReviewed?.(done))} />
      <Section title="Evidence">
        {view.data.evidence.map((e) => (
          <EvidenceCard key={`${e.entry}-${e.start}`} evidence={e} onOpen={() => navigate("entries", entryFocus(e.entry, e.start, e.end))} />
        ))}
        <StaleNote count={node.staleEvidence} />
      </Section>
      <Section title="Edges">
        <EdgeList view={view.data} labels={labels} onSelect={props.onSelect} />
      </Section>
      {view.data.derivedFrom.length + view.data.derivedInto.length > 0 ? (
        <Section title="Lineage">
          <p className="text-sm text-stone-600">
            {view.data.derivedFrom.map((n) => `from “${n.label}”`).join(", ")} {view.data.derivedInto.map((n) => `into “${n.label}”`).join(", ")}
          </p>
        </Section>
      ) : null}
      <Section title="Explore">
        <div className="flex gap-2">
          <Button onClick={traceRoots}>Trace roots</Button>
          <Button onClick={() => api.relatedToNode(id).then(setRelated)}>Related</Button>
        </div>
        <RootsList trace={trace} labels={labels} />
        {related ? <Related items={related} /> : null}
      </Section>
      {readOnly ? null : (
        <Section title="Refactor">
          <RefactorTools view={view.data} labels={labels} run={run} />
        </Section>
      )}
    </div>
  );
}
