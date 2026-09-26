import { api } from "../api";
import { ErrorNote, Page } from "../components/ui";
import { actorLabel, describeEvent, formatHlc, labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function LogView() {
  const data = useAsync(async () => {
    const [events, graph] = await Promise.all([api.timeline(), api.graph()]);
    return { events, labels: labelsFrom(graph, events) };
  });
  return (
    <Page title="Log" subtitle="The append-only record. Nothing here is ever edited or removed.">
      <ErrorNote error={data.error} />
      <table className="w-full text-sm">
        <tbody>
          {data.data?.events.map((e) => (
            <tr key={e.id} className="border-t border-stone-100 align-top">
              <td className="whitespace-nowrap py-2 pr-4 text-stone-400">{formatHlc(e.hlc)}</td>
              <td className="py-2 pr-4 text-stone-500">{actorLabel(e.actor)}</td>
              <td className="py-2 text-stone-700">{describeEvent(e, data.data?.labels ?? {})}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
