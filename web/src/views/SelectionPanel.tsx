import { api } from "../api";
import { ItemChip } from "../components/ItemChip";
import { Button, ErrorNote, StatusPill } from "../components/ui";
import { useAsync } from "../lib/useAsync";
import { type Done, ItemActions } from "./ItemControls";

/** Several selected Nodes/Edges. The selection is shared with agents over MCP (get_selection). */
export function SelectionPanel(props: { ids: string[]; version?: string; onClear: () => void; onFocus: (id: string) => void; onDone: (done: Done) => void }) {
  const selection = useAsync(api.selection, [props.ids.join(), props.version]);
  const items = selection.data?.items ?? [];
  return (
    <div className="space-y-4 p-5">
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-stone-800">{props.ids.length} selected</h3>
        <Button onClick={props.onClear}>Clear</Button>
      </header>
      <p className="text-xs text-stone-500">The assistant sees this selection: ask about “these”.</p>
      {items.length > 0 ? <ItemActions ids={props.ids} items={items} onDone={props.onDone} count /> : null}
      <ErrorNote error={selection.error} />
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2">
            <ItemChip id={item.id} label={item.label} onClick={() => props.onFocus(item.id)} />
            <StatusPill removed={item.removed} />
          </li>
        ))}
      </ul>
    </div>
  );
}
