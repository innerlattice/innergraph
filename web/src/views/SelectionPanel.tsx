import { api } from "../api";
import { Button, ErrorNote, StatusPill } from "../components/ui";
import { humanise } from "../lib/elements";
import { useAsync } from "../lib/useAsync";
import { ReviewActions } from "./ReviewControls";

/** Several selected Nodes/Edges. The selection is shared with agents over MCP (get_selection). */
export function SelectionPanel(props: { ids: string[]; version?: string; onClear: () => void; onDone: () => void }) {
  const selection = useAsync(api.selection, [props.ids.join(), props.version]);
  const items = selection.data?.items ?? [];
  return (
    <div className="space-y-4 p-5">
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-stone-800">{props.ids.length} selected</h3>
        <Button onClick={props.onClear}>Clear</Button>
      </header>
      <p className="text-xs text-stone-500">Your agent can see this selection: ask it about “the selected items”.</p>
      <ReviewActions ids={props.ids} onDone={props.onDone} approveLabel={`Approve ${props.ids.length}`} />
      <ErrorNote error={selection.error} />
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="block text-stone-800">{item.label}</span>
              <span className="text-xs text-stone-400">{humanise(item.type)} · {item.kind}</span>
            </span>
            <StatusPill status={item.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
