import { useState } from "react";
import type { Navigate } from "../App";
import { type NodeView, type RelatedItem, type RootTrace, api } from "../api";
import { Button, ErrorNote, StatusPill } from "../components/ui";
import { actorLabel, entryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";
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

function EdgeList(props: { view: NodeView; labels: Record<string, string> }) {
  const { view, labels } = props;
  const rows = [
    ...view.outgoing.map((e) => ({ id: e.id, text: `→ ${e.type} → ${labels[e.to] ?? e.to}` })),
    ...view.incoming.map((e) => ({ id: e.id, text: `← ${e.type} ← ${labels[e.from] ?? e.from}` })),
  ];
  if (rows.length === 0) return <p className="text-sm text-stone-400">No edges.</p>;
  return (
    <ul className="space-y-1 text-sm text-stone-600">
      {rows.map((r) => (
        <li key={r.id}>{r.text}</li>
      ))}
    </ul>
  );
}

function StatusActions(props: { view: NodeView; run: Run }) {
  const { node } = props.view;
  const set = (status: "accepted" | "parked" | "hypothesis") => props.run(() => api.setStatus(node.id, status));
  return (
    <div className="flex flex-wrap gap-2">
      {node.status === "hypothesis" ? <Button onClick={() => set("accepted")}>This fits</Button> : null}
      {node.status === "parked" ? <Button onClick={() => set("hypothesis")}>Un-park</Button> : <Button onClick={() => set("parked")}>Not now (park)</Button>}
    </div>
  );
}

function RefactorTools(props: { view: NodeView; labels: Record<string, string>; run: Run }) {
  const { view, labels, run } = props;
  const [name, setName] = useState(view.node.label);
  const [parts, setParts] = useState("");
  const [mergeWith, setMergeWith] = useState("");
  const others = Object.entries(labels).filter(([id]) => id !== view.node.id);
  const splitLabels = parts.split(",").map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2">
        <input aria-label="Label" className="min-w-0 flex-1 rounded-md border border-stone-200 px-2" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={name === view.node.label} onClick={() => run(() => api.rename(view.node.id, name))}>Rename</Button>
      </div>
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
  const view = useAsync(() => api.node(id), [id, version]);
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
        <h3 className="font-serif text-xl text-stone-800">{node.label}</h3>
        <StatusPill status={node.status} />
      </header>
      <ErrorNote error={error} />
      {readOnly ? null : <StatusActions view={view.data} run={run} />}
      <Section title="Evidence">
        {view.data.evidence.map((e) => (
          <EvidenceCard key={`${e.entry}-${e.start}`} evidence={e} onOpen={() => navigate("entries", entryFocus(e.entry, e.start, e.end))} />
        ))}
      </Section>
      <Section title="Edges">
        <EdgeList view={view.data} labels={labels} />
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
