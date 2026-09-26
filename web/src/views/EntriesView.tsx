import { useEffect, useRef, useState } from "react";
import type { Navigate } from "../App";
import { type EntryView, api } from "../api";
import { Card, Empty, ErrorNote, Page } from "../components/ui";
import { formatHlc, highlightSegments, parseEntryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";

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

export function EntriesView(props: { focus?: string; navigate: Navigate }) {
  const initial = parseEntryFocus(props.focus);
  const [selected, setSelected] = useState(initial.entry);
  const [focus, setFocus] = useState(initial.span);
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
          <Card>
            <EntryText view={entry.data} focus={focus} onOpen={(id) => props.navigate("map", id)} />
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
