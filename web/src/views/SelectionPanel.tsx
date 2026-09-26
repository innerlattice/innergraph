import { type ItemChange, type ViewStatus, api } from "../api";
import { Button, ErrorNote, StatusPill } from "../components/ui";
import { humanise } from "../lib/elements";
import { useAsync } from "../lib/useAsync";
import { PendingChanges, ReviewActions, type Reviewed, kindsFor } from "./ReviewControls";

/** Several selected Nodes/Edges. The selection is shared with agents over MCP (get_selection). */
export function SelectionPanel(props: {
  ids: string[];
  version?: string;
  changes?: ItemChange[];
  labels?: Record<string, string>;
  onClear: () => void;
  onFocus: (id: string) => void;
  onDone: (done: Reviewed) => void;
}) {
  const selection = useAsync(api.selection, [props.ids.join(), props.version]);
  const items = selection.data?.items ?? [];
  const kinds = kindsFor(items.map((i) => i.status as ViewStatus));
  return (
    <div className="space-y-4 p-5">
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-stone-800">{props.ids.length} selected</h3>
        <Button onClick={props.onClear}>Clear</Button>
      </header>
      <p className="text-xs text-stone-500">Your agent can see this selection: ask it about “the selected items”.</p>
      {kinds.length > 0 ? <ReviewActions ids={props.ids} kinds={kinds} onDone={props.onDone} labels={{ approve: `Approve ${props.ids.length}`, decline: `Decline ${props.ids.length}`, restore: `Restore ${props.ids.length}` }} /> : null}
      <PendingChanges changes={props.changes ?? []} labels={props.labels ?? {}} onDone={props.onDone} />
      <ErrorNote error={selection.error} />
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => props.onFocus(item.id)} className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-stone-100">
              <span className="min-w-0">
                <span className="block text-stone-800">{item.label}</span>
                <span className="text-xs text-stone-400">
                  {humanise(item.type)} · {item.kind}
                </span>
              </span>
              <StatusPill status={item.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
