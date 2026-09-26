// One quiet bar over the map: what changed recently, and whether removed items are shown.
export interface StatusBarProps {
  counts?: { active: number; removed: number };
  showRemoved: boolean;
  onShowRemoved: (show: boolean) => void;
  changesOpen: boolean;
  onChanges: () => void;
  duplicates: number;
}

export function StatusBar(props: StatusBarProps) {
  const removed = props.counts?.removed ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-stone-200 bg-stone-50 px-5 py-1.5 text-sm">
      <button
        type="button"
        aria-pressed={props.changesOpen}
        onClick={props.onChanges}
        className={`rounded-full border px-3 py-0.5 ${props.changesOpen ? "border-stone-400 bg-white text-stone-800" : "border-transparent text-stone-600 hover:bg-white"}`}
      >
        What changed
        {props.duplicates > 0 ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{props.duplicates} duplicate{props.duplicates === 1 ? "" : "s"}</span> : null}
      </button>
      <span className="text-xs text-stone-400">{props.counts?.active ?? 0} on the map</span>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
        <input type="checkbox" checked={props.showRemoved} onChange={(e) => props.onShowRemoved(e.target.checked)} />
        Show removed ({removed})
      </label>
    </div>
  );
}
