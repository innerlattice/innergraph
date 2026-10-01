import { useState } from "react";
import { type UndoResult, api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { formatHlc } from "../lib/format";

type Summary = UndoResult["summary"];

const PHRASES: [keyof Summary, string, string][] = [
  ["retired", "remove", "item added since|items added since"],
  ["restored", "bring back", "removed item|removed items"],
  ["changed", "undo", "change|changes"],
];

export function describeRevert(s: Summary): string {
  const parts = PHRASES.filter(([key]) => s[key] > 0).map(([key, verb, nouns]) => `${verb} ${s[key]} ${nouns.split("|")[s[key] === 1 ? 0 : 1]}`);
  return parts.length > 0 ? `This will ${parts.join(", ")}.` : "Nothing has changed since this point.";
}

/** Two-step revert: preview what changes, then confirm. History is kept, so it can be undone. */
export function RevertControl(props: { position: string; onReverted: () => void }) {
  const [preview, setPreview] = useState<Summary>();
  const [error, setError] = useState<string>();
  const fail = (e: Error) => setError(e.message);
  if (!preview) {
    return (
      <>
        <Button onClick={() => api.revertPreview(props.position).then(setPreview).catch(fail)}>Revert to here…</Button>
        <ErrorNote error={error} />
      </>
    );
  }
  const confirm = () =>
    api
      .revert(props.position)
      .then(() => (setPreview(undefined), props.onReverted()))
      .catch(fail);
  return (
    <div className="flex items-center gap-2 text-xs text-stone-600">
      <span>{describeRevert(preview)} Nothing is deleted; you can undo this from the Log.</span>
      <Button tone="primary" onClick={confirm}>
        Revert
      </Button>
      <Button onClick={() => setPreview(undefined)}>Cancel</Button>
      <ErrorNote error={error} />
    </div>
  );
}

export function TimeBar(props: { positions: string[]; index: number | undefined; onChange: (index: number | undefined) => void; onReverted: () => void }) {
  const { positions, index, onChange } = props;
  const last = positions.length - 1;
  return (
    <div className="relative z-10 space-y-1 bg-white px-5 shadow-raised py-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-40 shrink-0 text-stone-500">{index === undefined ? "Now, live" : formatHlc(positions[index])}</span>
        <input
          aria-label="Time travel"
          type="range"
          className="flex-1 accent-stone-700"
          min={0}
          max={Math.max(last, 0)}
          value={index ?? last}
          onChange={(e) => onChange(Number(e.target.value) === last ? undefined : Number(e.target.value))}
        />
        <Button disabled={index === undefined} onClick={() => onChange(undefined)}>
          Now
        </Button>
      </div>
      {index === undefined ? null : <RevertControl key={positions[index]} position={positions[index]} onReverted={() => (onChange(undefined), props.onReverted())} />}
    </div>
  );
}
