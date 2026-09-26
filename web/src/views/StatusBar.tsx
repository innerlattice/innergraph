// One bar for the map's state: what is waiting for review, and which statuses are shown.
import type { ViewStatus } from "../api";

export const STATUS_TEXT: Record<ViewStatus, { label: string; hint: string; swatch: string }> = {
  proposed: { label: "Proposed", hint: "Suggested, not yet approved (dashed outline)", swatch: "border-2 border-dashed border-amber-500 bg-amber-100" },
  approved: { label: "Approved", hint: "Confirmed by you (solid)", swatch: "border-2 border-stone-600 bg-stone-500" },
  parked: { label: "Parked", hint: "Set aside for now (grey)", swatch: "border-2 border-stone-300 bg-stone-200" },
  declined: { label: "Declined", hint: "Removed; can be restored (faint, dotted)", swatch: "border-2 border-dotted border-stone-300 bg-white" },
};

const ORDER: ViewStatus[] = ["proposed", "approved", "parked", "declined"];

export function toggle(filter: ViewStatus[], status: ViewStatus): ViewStatus[] {
  return filter.includes(status) ? filter.filter((s) => s !== status) : ORDER.filter((s) => s === status || filter.includes(s));
}

export interface StatusBarProps {
  counts?: Record<ViewStatus, number>;
  filter: ViewStatus[];
  onFilter: (filter: ViewStatus[]) => void;
  toReview: number;
  onReview: () => void;
}

export function StatusBar(props: StatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-stone-50 px-5 py-2 text-sm">
      <button
        type="button"
        onClick={props.onReview}
        disabled={props.toReview === 0}
        className="rounded-full bg-amber-500 px-3 py-1 font-medium text-white shadow-sm hover:bg-amber-600 disabled:bg-stone-200 disabled:text-stone-500"
      >
        {props.toReview > 0 ? `Review ${props.toReview}` : "Nothing to review"}
      </button>
      <span className="text-xs text-stone-400">Show:</span>
      {ORDER.map((status) => {
        const on = props.filter.includes(status);
        const text = STATUS_TEXT[status];
        return (
          <button
            key={status}
            type="button"
            aria-pressed={on}
            title={text.hint}
            onClick={() => props.onFilter(toggle(props.filter, status))}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-stone-400 bg-white text-stone-800" : "border-transparent text-stone-400 line-through"}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full ${text.swatch}`} />
            {text.label} <span className="text-stone-400">{props.counts?.[status] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
