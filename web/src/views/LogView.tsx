import { useState } from "react";
import { GRAPH_EVENT_TYPES } from "../../../src/core/types";
import { type AnyEvent, api } from "../api";
import { ErrorNote, Page } from "../components/ui";
import { actorLabel, describeEvent, formatHlc, labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";

/** Events whose effect on the graph can be undone (workflow and entry events cannot). */
export function undoable(e: AnyEvent): boolean {
  return GRAPH_EVENT_TYPES.includes(e.type);
}

export function LogView() {
  const [error, setError] = useState<string>();
  const data = useAsync(async () => {
    const [events, graph] = await Promise.all([api.timeline(), api.graph(true)]);
    return { events, labels: labelsFrom(graph, events) };
  });
  const undo = (id: string) =>
    api
      .undo(id)
      .then(() => (setError(undefined), data.reload()))
      .catch((e: Error) => setError(e.message));
  return (
    <Page title="Log" subtitle="The append-only record. Nothing here is ever edited or removed; undoing a change adds a new one.">
      <ErrorNote error={data.error ?? error} />
      <table className="w-full text-sm">
        <tbody>
          {data.data?.events.map((e) => (
            <tr key={e.id} className="group border-t border-stone-100 align-top">
              <td className="whitespace-nowrap py-2 pr-4 text-stone-400">{formatHlc(e.hlc)}</td>
              <td className="py-2 pr-4 text-stone-500">{actorLabel(e.actor)}</td>
              <td className="py-2 text-stone-700">{describeEvent(e, data.data?.labels ?? {})}</td>
              <td className="py-2 pl-4 text-right">
                {undoable(e) ? (
                  <button type="button" className="text-xs text-stone-400 opacity-0 hover:text-stone-800 hover:underline focus:opacity-100 group-hover:opacity-100" onClick={() => undo(e.id)}>
                    Undo
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
