// "What changed": recent Sessions (an entry decomposed, a rename, a merge…), newest first, each
// undoable as a whole, plus duplicates worth merging. Opened from the status bar.
import { BookOpen, Check, FilePen, type LucideIcon, Merge, Minus, PenLine, Plus, Quote, RotateCcw, Split } from "lucide-react";
import { useState } from "react";
import { Chip } from "../components/Chip";
import { ItemChip } from "../components/ItemChip";
import { type ChangeAction, type DuplicateGroup, type SessionChanges, api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { actorLabel, formatHlc } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { ICON } from "../design/tokens";

// Each change is marked like a diff: a green plus for what arrived, a red minus for what went, a
// pen for what was reworded. The mark carries a word for screen readers and on hover, so colour is
// never the only signal. `joiner` links the item to the row's detail: "Renamed to B".
const MARK: Record<ChangeAction, { icon: LucideIcon; word: string; tone: string; joiner?: string }> = {
  added: { icon: Plus, word: "Added", tone: "text-diff-add" },
  updated: { icon: Quote, word: "More evidence", tone: "text-stone-400" },
  renamed: { icon: PenLine, word: "Renamed", tone: "text-clay-500", joiner: "to" },
  edited: { icon: PenLine, word: "Edited", tone: "text-clay-500" },
  removed: { icon: Minus, word: "Removed", tone: "text-diff-remove" },
  restored: { icon: RotateCcw, word: "Restored", tone: "text-diff-add" },
  confirmed: { icon: Check, word: "Confirmed", tone: "text-sage-600" },
  merged: { icon: Merge, word: "Merged", tone: "text-stone-500", joiner: "from" },
  split: { icon: Split, word: "Split", tone: "text-stone-500", joiner: "into" },
  revised: { icon: FilePen, word: "Entry edited", tone: "text-clay-500" },
};

function Mark(props: { action: ChangeAction }) {
  const { icon: Icon, word, tone } = MARK[props.action];
  return (
    <span title={word} className={`flex h-5 w-4 shrink-0 items-center justify-center ${tone}`}>
      <Icon size={ICON.md} strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{word}</span>
    </span>
  );
}

function ChangeRowView(props: { row: SessionChanges["rows"][number]; onFocus: (ids: string[]) => void }) {
  const { row } = props;
  const mark = MARK[row.action];
  return (
    <li className="flex items-start gap-1.5">
      <Mark action={row.action} />
      <div className="min-w-0 flex-1">
        {row.kind === "entry" ? (
          <Chip lead={<BookOpen size={ICON.xs} aria-hidden />}>{row.label}</Chip>
        ) : (
          <ItemChip id={row.id} label={row.label} onClick={() => props.onFocus([row.id])} />
        )}
        {row.detail ? (
          <p className="mt-0.5 pl-2.5 text-xs text-stone-400">
            {mark.word} {mark.joiner ?? "with"} {row.detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

const PURPOSE: Record<string, string> = {
  ingest: "New entry",
  revise: "Entry edited",
  propose: "Added to the map",
  amend: "Corrections",
  remove: "Removed",
  confirm: "Confirmed",
  refactor: "Refactor",
  deduplicate: "Duplicates cleaned up",
  undo: "Undo",
  revert: "Revert",
  restore: "Restored",
  edit: "Edit",
  schema: "Schema",
};

function SessionCard(props: { change: SessionChanges; onFocus: (ids: string[]) => void; onUndone: () => void }) {
  const { change } = props;
  const [error, setError] = useState<string>();
  const undo = () => api.undoSession(change.session).then(props.onUndone).catch((e: Error) => setError(e.message));
  const focusable = change.rows.filter((r) => r.kind !== "entry");
  return (
    <li className="space-y-2 rounded-xl bg-white p-3 shadow-raised">
      <header className="flex items-start justify-between gap-3">
        <button type="button" className="text-left" onClick={() => props.onFocus(focusable.map((r) => r.id))} disabled={focusable.length === 0}>
          <span className="block text-sm font-medium text-stone-800">{PURPOSE[change.purpose] ?? change.purpose}</span>
          <span className="flex flex-wrap gap-x-2 text-xs text-stone-400">
            <span>by {actorLabel(change.actor)}</span>
            <time>{formatHlc(change.at)}</time>
          </span>
        </button>
        <Button onClick={undo} title="Undo everything in this change">
          Undo
        </Button>
      </header>
      <ul className="space-y-1">
        {change.rows.map((row, i) => (
          <ChangeRowView key={`${row.id}-${i}`} row={row} onFocus={props.onFocus} />
        ))}
      </ul>
      <ErrorNote error={error} />
    </li>
  );
}

function Duplicates(props: { groups: DuplicateGroup[]; labels: Record<string, string>; onFocus: (ids: string[]) => void; onDone: () => void }) {
  if (props.groups.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">Possible duplicates</h4>
      <ul className="space-y-2">
        {props.groups.map((g) => (
          <li key={g.ids.join()} className="flex items-center justify-between gap-2 rounded-lg bg-clay-50 p-2 text-sm">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-stone-600">
              <ItemChip id={g.ids[0]} label={props.labels[g.ids[0]]} onClick={() => props.onFocus(g.ids)} />
              <span>recorded {g.ids.length} times</span>
            </span>
            <Button onClick={() => api.mergeDuplicates([g]).then(props.onDone)}>Merge</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface ChangesPanelProps {
  version: string;
  duplicates?: DuplicateGroup[];
  labels: Record<string, string>;
  onFocus: (ids: string[]) => void;
  onChanged: () => void;
  onClose: () => void;
}

export function ChangesPanel(props: ChangesPanelProps) {
  const changes = useAsync(() => api.changes(), [props.version]);
  const done = () => (changes.reload(), props.onChanged());
  return (
    <div className="space-y-5 p-5">
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-stone-800">What changed</h3>
        <Button onClick={props.onClose}>Close</Button>
      </header>
      <Duplicates groups={props.duplicates ?? []} labels={props.labels} onFocus={props.onFocus} onDone={done} />
      <ErrorNote error={changes.error} />
      {changes.data?.length === 0 ? <p className="text-sm text-stone-500">Nothing yet.</p> : null}
      <ul className="space-y-3">
        {(changes.data ?? []).map((c) => (
          <SessionCard key={c.session} change={c} onFocus={props.onFocus} onUndone={done} />
        ))}
      </ul>
    </div>
  );
}
