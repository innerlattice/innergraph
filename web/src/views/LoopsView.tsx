import type { Navigate } from "../App";
import { type Loop, api } from "../api";
import { Card, Empty, ErrorNote, Page } from "../components/ui";
import { labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const POLARITY_TEXT: Record<Loop["polarity"], string> = {
  reinforcing: "Reinforcing: each step amplifies the next",
  balancing: "Balancing: the loop damps itself",
};

export function LoopCard(props: { loop: Loop; labels: Record<string, string>; onOpen: (id: string) => void }) {
  const { loop, labels, onOpen } = props;
  return (
    <Card>
      <p className={`mb-2 text-xs ${loop.polarity === "reinforcing" ? "text-orange-700" : "text-sky-700"}`}>{POLARITY_TEXT[loop.polarity]}</p>
      <p className="flex flex-wrap items-center gap-1 text-sm">
        {[...loop.nodes, loop.nodes[0]].map((id, i) => (
          <span key={`${id}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <span className="text-stone-400">→</span> : null}
            <button type="button" className="rounded bg-stone-100 px-2 py-0.5 text-stone-700 hover:bg-stone-200" onClick={() => onOpen(id)}>
              {labels[id] ?? id}
            </button>
          </span>
        ))}
      </p>
    </Card>
  );
}

export function LoopsView(props: { navigate: Navigate }) {
  const data = useAsync(async () => {
    const [loops, graph] = await Promise.all([api.loops(), api.graph()]);
    return { loops, labels: labelsFrom(graph) };
  });
  return (
    <Page title="Loops" subtitle="Cycles over causal edges. A loop is a pattern to notice, not a problem to fix.">
      <ErrorNote error={data.error} />
      <div className="space-y-3">
        {data.data?.loops.length === 0 ? <Empty>No feedback loops yet.</Empty> : null}
        {data.data?.loops.map((loop) => (
          <LoopCard key={loop.edges.join()} loop={loop} labels={data.data?.labels ?? {}} onOpen={(id) => props.navigate("map", id)} />
        ))}
      </div>
    </Page>
  );
}
