import { useEffect, useRef, useState } from "react";
import type { Navigate } from "../App";
import { type EntryView, type RevisionResult, api } from "../api";
import { Button, Card, Empty, ErrorNote, Page } from "../components/ui";
import { formatHlc, highlightSegments, parseEntryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useJob } from "../lib/useJob";

const FOCUS = "\u0000focus";

type Span = { start: number; end: number };

function markClass(focused: boolean): string {
  const base = "cursor-pointer rounded text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";
  return `${base} ${focused ? "bg-amber-300 ring-2 ring-amber-400" : "bg-amber-100/70 hover:bg-amber-200"}`;
}

export function EntryText(props: { view: EntryView; focus?: Span; onOpen: (id: string) => void }) {
  const { view, focus, onOpen } = props;
  const container = useRef<HTMLParagraphElement>(null);
  const labels = Object.fromEntries(view.citations.map((c) => [c.target, c.label]));
  const spans = view.citations.map((c) => ({ target: c.target, ...c.evidence }));
  const segments = highlightSegments(view.text, focus ? [...spans, { target: FOCUS, ...focus }] : spans);

  useEffect(() => {
    container.current?.querySelector("[data-focus]")?.scrollIntoView?.({ block: "center" });
  }, [focus?.start, view.entry.id]);

  return (
    <p ref={container} className="whitespace-pre-wrap font-serif leading-relaxed text-stone-800">
      {segments.map((s, i) => {
        const cited = s.cited.filter((id) => id !== FOCUS);
        const focused = s.cited.includes(FOCUS);
        if (cited.length === 0 && !focused) return <span key={i}>{s.text}</span>;
        return (
          <mark
            key={i}
            role="button"
            tabIndex={0}
            data-focus={focused || undefined}
            aria-label={`${s.text} — supports ${cited.map((id) => labels[id]).join(", ")}`}
            title={cited.map((id) => labels[id]).join(", ")}
            className={markClass(focused)}
            onClick={() => cited[0] && onOpen(cited[0])}
            onKeyDown={(e) => e.key === "Enter" && cited[0] && onOpen(cited[0])}
          >
            {s.text}
          </mark>
        );
      })}
    </p>
  );
}

function revisionSummary(result: RevisionResult): string {
  const stale = result.cited.filter((c) => !c.moved).length;
  const moved = `${result.remapped} cited passage${result.remapped === 1 ? "" : "s"} carried over`;
  return stale > 0 ? `${moved}; ${stale} item${stale === 1 ? "" : "s"} cite text that changed.` : `${moved}.`;
}

/** Edit an Entry. Saving stores a revision; the old version stays in history. */
export function EntryEditor(props: { view: EntryView; onSaved: (result: RevisionResult) => void; onCancel: () => void }) {
  const [text, setText] = useState(props.view.text);
  const [interpret, setInterpret] = useState(true);
  const [error, setError] = useState<string>();
  const save = () =>
    api
      .revise(props.view.entry.id, text, interpret)
      .then(props.onSaved)
      .catch((e: Error) => setError(e.message));
  return (
    <div className="space-y-3">
      <textarea aria-label="Entry text" className="h-72 w-full resize-y rounded-md border border-stone-200 p-3 font-serif leading-relaxed outline-none focus:border-stone-400" value={text} onChange={(e) => setText(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" checked={interpret} onChange={(e) => setInterpret(e.target.checked)} />
        Update the map from the changes (the model sees the old and new text and the items citing it)
      </label>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={text === props.view.text} onClick={save}>
          Save revision
        </Button>
        <Button onClick={props.onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** Everything this entry is evidence for, each one clickable, plus all of them at once. */
export function SupportedItems(props: { view: EntryView; onOpen: (ids: string) => void }) {
  const items = [...new Map(props.view.citations.map((c) => [c.target, c.label])).entries()];
  if (items.length === 0) return <p className="text-xs text-stone-400">Nothing on the map cites this entry yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => props.onOpen(items.map(([id]) => id).join(","))} className="rounded-full bg-clay-500 px-3 py-0.5 text-xs text-white hover:bg-clay-600">
        Show all {items.length} on the map
      </button>
      {items.map(([id, label]) => (
        <button key={id} type="button" onClick={() => props.onOpen(id)} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-xs text-stone-700 hover:border-clay-300 hover:bg-clay-50">
          {label}
        </button>
      ))}
    </div>
  );
}

function RevisionNote(props: { result: RevisionResult }) {
  const job = useJob(props.result.job?.id);
  const updating = job?.state === "running" || job?.state === "queued";
  return <p className="text-sm text-stone-600">Saved. {revisionSummary(props.result)} {updating ? "Updating the map…" : ""}</p>;
}

function EntryCard(props: { view: EntryView; focus?: Span; navigate: Navigate; revision?: RevisionResult; onRevised: (result: RevisionResult) => void }) {
  const [editing, setEditing] = useState(false);
  const result = props.revision?.entry === props.view.entry.id ? props.revision : undefined;
  const saved = (r: RevisionResult) => {
    setEditing(false);
    props.onRevised(r);
  };
  return (
    <Card className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-400">{props.view.entry.revises ? "Revised version · earlier versions stay in history" : formatHlc(props.view.entry.addedAt)}</p>
        {editing ? null : <Button onClick={() => setEditing(true)}>Edit</Button>}
      </header>
      <SupportedItems view={props.view} onOpen={(ids) => props.navigate("map", ids)} />
      {result ? <RevisionNote result={result} /> : null}
      {editing ? <EntryEditor view={props.view} onSaved={saved} onCancel={() => setEditing(false)} /> : <EntryText view={props.view} focus={props.focus} onOpen={(id) => props.navigate("map", id)} />}
    </Card>
  );
}

export function EntriesView(props: { focus?: string; navigate: Navigate }) {
  const initial = parseEntryFocus(props.focus);
  const [selected, setSelected] = useState(initial.entry);
  const [focus, setFocus] = useState(initial.span);
  const [revision, setRevision] = useState<RevisionResult>();
  const entries = useAsync(api.entries);
  const entry = useAsync(() => (selected ? api.entry(selected) : Promise.resolve(undefined)), [selected]);
  const choose = (id: string) => {
    setSelected(id);
    setFocus(undefined);
  };
  return (
    <Page title="Entries" subtitle="Highlighted passages are cited as evidence. Select one to open what it supports.">
      <ErrorNote error={entries.error} />
      {entries.data?.length === 0 ? <Empty>No entries yet.</Empty> : null}
      <div className="grid grid-cols-[14rem_1fr] gap-6">
        <ul className="space-y-1">
          {entries.data?.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => choose(e.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${selected === e.id ? "bg-stone-200" : "hover:bg-stone-100"}`}>
                <span className="block truncate text-stone-800">{e.title}</span>
                <span className="text-xs text-stone-400">{formatHlc(e.addedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
        {entry.data ? (
          <EntryCard key={entry.data.entry.id} view={entry.data} focus={focus} navigate={props.navigate} revision={revision} onRevised={(r) => (setRevision(r), entries.reload(), setSelected(r.entry))} />
        ) : null}
      </div>
    </Page>
  );
}
