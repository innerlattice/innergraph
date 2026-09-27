import { History } from "lucide-react";

// One quiet bar over the map: what changed recently, and whether removed items are shown.
export interface StatusBarProps {
  /** How many removed items the toggle would bring back. */
  removed?: number;
  showRemoved: boolean;
  onShowRemoved: (show: boolean) => void;
  changesOpen: boolean;
  onChanges: () => void;
  duplicates: number;
}

// A toggle that looks like the buttons it sits among: raised while closed, pressed in while open.
const CHANGES = {
  closed: "bg-white text-stone-700 shadow-raised hover:shadow-floating hover:bg-clay-50",
  open: "bg-stone-200/60 text-stone-800 shadow-inset",
};

export function StatusBar(props: StatusBarProps) {
  const removed = props.removed ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-4 bg-stone-50 px-5 shadow-raised py-1.5 text-sm">
      <button
        type="button"
        aria-pressed={props.changesOpen}
        onClick={props.onChanges}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${props.changesOpen ? CHANGES.open : CHANGES.closed}`}
      >
        <History size={14} aria-hidden="true" />
        What changed
        {props.duplicates > 0 ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{props.duplicates} duplicate{props.duplicates === 1 ? "" : "s"}</span> : null}
      </button>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
        <input type="checkbox" checked={props.showRemoved} onChange={(e) => props.onShowRemoved(e.target.checked)} />
        Show removed ({removed})
      </label>
    </div>
  );
}
