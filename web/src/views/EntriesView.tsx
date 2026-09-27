import { Map as MapIcon, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExploreButton } from "../components/ExploreButton";
import { IconButton } from "../components/IconButton";
import { ItemChip } from "../components/ItemChip";
import type { Navigate } from "../App";
import { type EntryView, type RevisionResult, api } from "../api";
import { Button, Card, Empty, ErrorNote, Page, passageClass } from "../components/ui";
import { formatHlc, citedRuns, parseEntryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useJob } from "../lib/useJob";
import { useLive } from "../lib/useLive";

const FOCUS = "\u0000focus";

type Span = { start: number; end: number };

/** Which items the pointer is on, in the text or the chips below it, so the other side can light them. */
interface Hover {
  lit: string[];
  onHover: (ids: string[]) => void;
}

const NO_HOVER: Hover = { lit: [], onHover: () => undefined };

export function EntryText(props: { view: EntryView; focus?: Span; onOpen: (id: string) => void; hover?: Hover }) {
  const { view, focus, onOpen, hover = NO_HOVER } = props;
  const container = useRef<HTMLParagraphElement>(null);
  const labels = Object.fromEntries(view.citations.map((c) => [c.target, c.label]));
  const spans = view.citations.map((c) => ({ target: c.target, ...c.evidence }));
  const segments = citedRuns(view.text, focus ? [...spans, { target: FOCUS, ...focus }] : spans);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the passage whenever the focus or entry changes
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
          // biome-ignore lint/a11y/useSemanticElements: a highlighted passage in running text; a button would break the text's flow and selection
          <mark
            key={i}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: it is clickable and focusable like a button
            role="button"
            tabIndex={0}
            data-focus={focused || undefined}
            aria-label={`${s.text} — supports ${cited.map((id) => labels[id]).join(", ")}`}
            title={cited.map((id) => labels[id]).join(", ")}
            className={passageClass(focused ? "focused" : cited.some((id) => hover.lit.includes(id)) ? "lit" : "rest")}
            onMouseEnter={() => hover.onHover(cited)}
            onMouseLeave={() => hover.onHover([])}
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
      <textarea
        aria-label="Entry text"
        className="h-72 w-full resize-y rounded-md border border-stone-200 p-3 font-serif leading-relaxed outline-none focus:border-stone-400"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
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

/** Each item this entry is evidence for, once, with its label. */
function supported(view: EntryView): [string, string][] {
  return [...new Map(view.citations.map((c) => [c.target, c.label])).entries()];
}

/** Everything this entry is evidence for, each one clickable. */
export function SupportedItems(props: { view: EntryView; onOpen: (ids: string) => void; hover?: Hover }) {
  const { hover = NO_HOVER } = props;
  const items = supported(props.view);
  if (items.length === 0) return <p className="text-xs text-stone-400">Nothing on the map cites this entry yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map(([id, label]) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: hovering only lights the passages; the chip inside is the control
        <span key={id} className="inline-flex min-w-0 max-w-full" onMouseEnter={() => hover.onHover([id])} onMouseLeave={() => hover.onHover([])}>
          <ItemChip id={id} label={label} lit={hover.lit.includes(id)} onClick={() => props.onOpen(id)} />
        </span>
      ))}
    </div>
  );
}

function RevisionNote(props: { result: RevisionResult }) {
  const job = useJob(props.result.job?.id);
  const updating = job?.state === "running" || job?.state === "queued";
  return (
    <p className="text-sm text-stone-600">
      Saved. {revisionSummary(props.result)} {updating ? "Updating the map…" : ""}
    </p>
  );
}

function EntryCard(props: { view: EntryView; focus?: Span; navigate: Navigate; revision?: RevisionResult; onRevised: (result: RevisionResult) => void }) {
  const [editing, setEditing] = useState(false);
  const [lit, setLit] = useState<string[]>([]);
  const hover: Hover = { lit, onHover: setLit };
  const result = props.revision?.entry === props.view.entry.id ? props.revision : undefined;
  const cited = supported(props.view).map(([id]) => id);
  const saved = (r: RevisionResult) => {
    setEditing(false);
    props.onRevised(r);
  };
  return (
    <Card className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-400">{props.view.entry.revises ? "Revised version. Earlier versions stay in history." : formatHlc(props.view.entry.addedAt)}</p>
        {editing ? null : (
          <div className="flex gap-2">
            <ExploreButton subject="entry" kind="Entry" name={props.view.entry.title} target={props.view.entry.id} />
            <IconButton label="Edit" hint="Change what you wrote; the map follows" icon={Pencil} onClick={() => setEditing(true)} />
            {cited.length > 0 ? (
              <IconButton label="Show on map" hint={`Light up all ${cited.length} things it supports`} icon={MapIcon} onClick={() => props.navigate("map", cited.join(","))} />
            ) : null}
          </div>
        )}
      </header>
      {result ? <RevisionNote result={result} /> : null}
      {editing ? (
        <EntryEditor view={props.view} onSaved={saved} onCancel={() => setEditing(false)} />
      ) : (
        <EntryText view={props.view} focus={props.focus} hover={hover} onOpen={(id) => props.navigate("map", id)} />
      )}
      <SupportedItems view={props.view} hover={hover} onOpen={(ids) => props.navigate("map", ids)} />
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
  // A rename, a new entry or an item removed elsewhere shows here as it happens.
  useLive(() => (entries.reload(), entry.reload()));
  const choose = (id: string) => {
    setSelected(id);
    setFocus(undefined);
  };
  return (
    <Page title="Entries" subtitle="Highlighted passages are cited as evidence. Select one to open what it supports.">
      <ErrorNote error={entries.error} />
      {entries.data?.length === 0 ? <Empty>No entries yet.</Empty> : null}
      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-sidebar [&>*]:min-w-0">
        <ul className="space-y-1">
          {entries.data?.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => choose(e.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${selected === e.id ? "bg-stone-200" : "hover:bg-stone-100"}`}
              >
                <span className="block truncate text-stone-800">{e.title}</span>
                <span className="text-xs text-stone-400">{formatHlc(e.addedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
        {entry.data ? (
          <EntryCard
            key={entry.data.entry.id}
            view={entry.data}
            focus={focus}
            navigate={props.navigate}
            revision={revision}
            onRevised={(r) => (setRevision(r), entries.reload(), setSelected(r.entry))}
          />
        ) : null}
      </div>
    </Page>
  );
}
