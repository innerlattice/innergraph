import { History, Search, Sparkles } from "lucide-react";
import { ICON } from "../design/tokens";

// One quiet bar over the map: its history, a search, and whether removed items are shown.
export interface StatusBarProps {
  /** How many removed items the toggle would bring back. */
  removed?: number;
  showRemoved: boolean;
  onShowRemoved: (show: boolean) => void;
  changesOpen: boolean;
  onChanges: () => void;
  duplicates: number;
  query: string;
  onQuery: (query: string) => void;
  /** How many things on the map the search found, while searching. */
  found?: number;
  /** Lays the whole map out afresh, clear of overlaps. */
  onTidy: () => void;
}

// A toggle that looks like the buttons it sits among: raised while closed, pressed in while open.
const CHANGES = {
  closed: "bg-white text-stone-700 shadow-raised hover:shadow-floating hover:bg-clay-50",
  open: "bg-stone-200/60 text-stone-800 shadow-inset",
};

export function StatusBar(props: StatusBarProps) {
  const removed = props.removed ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-stone-50 px-5 shadow-raised py-1.5 text-sm">
      <button
        type="button"
        aria-pressed={props.changesOpen}
        onClick={props.onChanges}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${props.changesOpen ? CHANGES.open : CHANGES.closed}`}
      >
        <History size={ICON.md} aria-hidden="true" />
        History
        {props.duplicates > 0 ? (
          <span className="ml-1.5 rounded-full bg-clay-100 px-1.5 text-xs text-clay-700">
            {props.duplicates} duplicate{props.duplicates === 1 ? "" : "s"}
          </span>
        ) : null}
      </button>
      <label className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-stone-500 shadow-inset focus-within:text-stone-800">
        <Search size={ICON.sm} aria-hidden="true" />
        <input
          type="search"
          aria-label="Find on the map"
          placeholder="Find on the map"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && props.onQuery("")}
          className="w-32 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
        />
        {props.found === undefined ? null : <span className="text-xs whitespace-nowrap text-stone-400">{props.found === 0 ? "Nothing found" : `${props.found} found`}</span>}
      </label>
      <button
        type="button"
        onClick={props.onTidy}
        title="Lay the map out afresh so nothing overlaps"
        className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-800"
      >
        <Sparkles size={ICON.sm} aria-hidden="true" />
        Tidy up
      </button>
      <label className=" flex items-center gap-1.5 text-xs text-stone-500">
        <input type="checkbox" checked={props.showRemoved} onChange={(e) => props.onShowRemoved(e.target.checked)} />
        Show removed ({removed})
      </label>
    </div>
  );
}
