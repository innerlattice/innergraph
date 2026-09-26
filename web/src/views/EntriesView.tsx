import { useState } from "react";
import type { Navigate } from "../App";
import { type EntryView, api } from "../api";
import { Card, Empty, ErrorNote, Page } from "../components/ui";
import { formatHlc, highlightSegments } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function EntryText(props: { view: EntryView; onOpen: (id: string) => void }) {
  const { view, onOpen } = props;
  const labels = Object.fromEntries(view.citations.map((c) => [c.target, c.label]));
  const segments = highlightSegments(view.text, view.citations.map((c) => ({ target: c.target, ...c.evidence })));
  return (
    <p className="whitespace-pre-wrap font-serif leading-relaxed text-stone-800">
      {segments.map((s, i) =>
        s.cited.length === 0 ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark
            key={i}
            role="button"
            tabIndex={0}
            title={s.cited.map((id) => labels[id]).join(", ")}
            className="cursor-pointer rounded bg-amber-100/70 text-inherit hover:bg-amber-200"
            onClick={() => onOpen(s.cited[0])}
            onKeyDown={(e) => e.key === "Enter" && onOpen(s.cited[0])}
          >
            {s.text}
          </mark>
        ),
      )}
    </p>
  );
}

export function EntriesView(props: { focus?: string; navigate: Navigate }) {
  const [selected, setSelected] = useState(props.focus);
  const entries = useAsync(api.entries);
  const entry = useAsync(() => (selected ? api.entry(selected) : Promise.resolve(undefined)), [selected]);
  return (
    <Page title="Entries" subtitle="Highlighted passages are cited as evidence. Select one to open what it supports.">
      <ErrorNote error={entries.error} />
      {entries.data?.length === 0 ? <Empty>No entries yet.</Empty> : null}
      <div className="grid grid-cols-[14rem_1fr] gap-6">
        <ul className="space-y-1">
          {entries.data?.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setSelected(e.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${selected === e.id ? "bg-stone-200" : "hover:bg-stone-100"}`}>
                <span className="block truncate text-stone-800">{e.title}</span>
                <span className="text-xs text-stone-400">{formatHlc(e.addedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
        {entry.data ? (
          <Card>
            <EntryText view={entry.data} onOpen={(id) => props.navigate("map", id)} />
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
