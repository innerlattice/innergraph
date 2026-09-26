// "What changed": recent Sessions (an entry decomposed, a rename, a merge…), newest first, each
// undoable as a whole, plus duplicates worth merging. Opened from the status bar.
import { useState } from "react";
import { type ChangeAction, type DuplicateGroup, type SessionChanges, api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { actorLabel, formatHlc } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const VERB: Record<ChangeAction, { text: string; tone: string }> = {
  added: { text: "added", tone: "text-emerald-700" },
  updated: { text: "more evidence", tone: "text-stone-500" },
  renamed: { text: "renamed", tone: "text-sky-700" },
  edited: { text: "edited", tone: "text-sky-700" },
  removed: { text: "removed", tone: "text-rose-700" },
  restored: { text: "restored", tone: "text-emerald-700" },
  confirmed: { text: "confirmed", tone: "text-emerald-700" },
  merged: { text: "merged", tone: "text-violet-700" },
  split: { text: "split", tone: "text-violet-700" },
  revised: { text: "edited entry", tone: "text-sky-700" },
};

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
    <li className="space-y-2 rounded-lg border border-stone-200 p-3">
      <header className="flex items-start justify-between gap-3">
        <button type="button" className="text-left" onClick={() => props.onFocus(focusable.map((r) => r.id))} disabled={focusable.length === 0}>
          <span className="block text-sm font-medium text-stone-800">{PURPOSE[change.purpose] ?? change.purpose}</span>
          <span className="text-xs text-stone-400">
            by {actorLabel(change.actor)} · {formatHlc(change.at)}
          </span>
        </button>
        <Button onClick={undo} title="Undo everything in this change">
          Undo
        </Button>
      </header>
      <ul className="space-y-0.5 text-sm">
        {change.rows.map((row, i) => (
          <li key={`${row.id}-${i}`}>
            <button type="button" disabled={row.kind === "entry"} onClick={() => props.onFocus([row.id])} className="w-full rounded px-1 text-left hover:bg-stone-100 disabled:hover:bg-transparent">
              <span className={`text-xs ${VERB[row.action].tone}`}>{VERB[row.action].text}</span> <span className="text-stone-700">{row.label}</span>
              {row.detail ? <span className="text-stone-400"> · {row.detail}</span> : null}
            </button>
          </li>
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
          <li key={g.ids.join()} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-sm">
            <button type="button" onClick={() => props.onFocus(g.ids)} className="text-left text-stone-800 hover:underline">
              “{props.labels[g.ids[0]] ?? g.ids[0]}” is recorded {g.ids.length} times
            </button>
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
