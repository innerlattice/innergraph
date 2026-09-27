import { type ViewStatus, api } from "../api";
import { ItemLabel } from "../components/Chip";
import { Button, ErrorNote, StatusPill } from "../components/ui";
import { humanise } from "../../../src/core/edgeText";
import { useAsync } from "../lib/useAsync";
import { type Done, ItemActions } from "./ItemControls";

/** Several selected Nodes/Edges. The selection is shared with agents over MCP (get_selection). */
export function SelectionPanel(props: {
  ids: string[];
  version?: string;
  onClear: () => void;
  onFocus: (id: string) => void;
  onDone: (done: Done) => void;
}) {
  const selection = useAsync(api.selection, [props.ids.join(), props.version]);
  const items = selection.data?.items ?? [];
  const states = items.map((i) => ({ status: i.status as ViewStatus, confirmed: i.confirmed }));
  return (
    <div className="space-y-4 p-5">
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-stone-800">{props.ids.length} selected</h3>
        <Button onClick={props.onClear}>Clear</Button>
      </header>
      <p className="text-xs text-stone-500">The assistant sees this selection: ask about “these”.</p>
      {items.length > 0 ? <ItemActions ids={props.ids} items={states} onDone={props.onDone} count /> : null}
      <ErrorNote error={selection.error} />
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => props.onFocus(item.id)} className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-stone-100">
              <span className="min-w-0">
                <span className="block text-stone-800">
                  <ItemLabel label={item.label} />
                </span>
                <span className="text-xs text-stone-400">
                  {humanise(item.type)} {item.kind}
                </span>
              </span>
              <StatusPill status={item.status} confirmed={item.confirmed} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
