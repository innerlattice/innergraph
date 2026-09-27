// What sits around a node or edge's title: what kind of thing it is, how sure the map is of it, and
// who put it there. Each has its own element and form, so none of it runs together as a list.
import type { ReactNode } from "react";
import { actorLabel, pct } from "../lib/format";
import { Tooltip } from "./Tooltip";

/** A short bar pressed into the page, filled as far as the map is sure. */
function Confidence(props: { value: number }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native meter can't take the design's track and fill
    <span
      role="meter"
      aria-label="Confidence"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.value * 100)}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-stone-500"
    >
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-stone-200 shadow-inset">
        <span className="block h-full rounded-full bg-clay-400" style={{ width: pct(props.value) }} />
      </span>
      {pct(props.value)} sure
    </span>
  );
}

/** The line above the title: the kind, with the mark the map draws it with, and the confidence.
 *  Hovering the kind shows `tip`, which says what that kind of thing is. */
export function Eyebrow(props: { mark: ReactNode; kind: string; confidence: number; tip: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Tooltip content={props.tip}>
        <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-500">
          {props.mark}
          <span className="truncate">{props.kind}</span>
        </span>
      </Tooltip>
      <Confidence value={props.confidence} />
    </div>
  );
}

/** Who put it on the map: provenance, so it closes the card rather than leading it. */
export function AddedBy(props: { actor: string }) {
  return <footer className="text-xs text-stone-400">Added by {actorLabel(props.actor)}</footer>;
}
