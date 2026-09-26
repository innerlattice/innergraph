import { useMemo, useState } from "react";
import type { Navigate } from "../App";
import { type Graph, api } from "../api";
import { GraphCanvas } from "../components/GraphCanvas";
import { Button, Empty, ErrorNote } from "../components/ui";
import { toElements } from "../lib/elements";
import { formatHlc, labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { NodePanel } from "./NodePanel";

function loadGraph(position: string | undefined): Promise<Graph> {
  return position ? api.graphAt(position).then((g) => g.graph) : api.graph();
}

function TimeBar(props: { positions: string[]; index: number | undefined; onChange: (index: number | undefined) => void }) {
  const { positions, index, onChange } = props;
  const last = positions.length - 1;
  return (
    <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-2 text-sm">
      <span className="w-40 shrink-0 text-stone-500">{index === undefined ? "Now" : formatHlc(positions[index])}</span>
      <input aria-label="Time travel" type="range" className="flex-1 accent-stone-700" min={0} max={Math.max(last, 0)} value={index ?? last} onChange={(e) => onChange(Number(e.target.value) === last ? undefined : Number(e.target.value))} />
      <Button disabled={index === undefined} onClick={() => onChange(undefined)}>Now</Button>
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 space-y-0.5 rounded-md bg-white/85 px-3 py-2 text-xs text-stone-500">
      <p>dashed = hypothesis · faded = parked</p>
      <p><span className="text-orange-700">orange</span> increases · <span className="text-sky-700">blue</span> decreases · thick = derivation</p>
    </div>
  );
}

export function MapView(props: { focus?: string; navigate: Navigate }) {
  const [selected, setSelected] = useState<string | undefined>(props.focus);
  const [index, setIndex] = useState<number>();
  const [highlight, setHighlight] = useState<string[]>([]);
  const positions = useAsync(api.positions);
  const status = useAsync(api.status);
  const position = index === undefined ? undefined : positions.data?.[index];
  const graph = useAsync(() => loadGraph(position), [position]);
  const schema = status.data?.schema ?? null;
  const elements = useMemo(() => (graph.data ? toElements(graph.data, schema) : []), [graph.data, schema]);
  const labels = useMemo(() => (graph.data ? labelsFrom(graph.data) : {}), [graph.data]);
  const empty = graph.data && Object.keys(graph.data.nodes).length === 0;

  const select = (id: string | undefined) => {
    setSelected(id && labels[id] ? id : undefined);
    setHighlight([]);
  };

  return (
    <div className="flex h-full flex-col">
      <TimeBar positions={positions.data ?? []} index={index} onChange={setIndex} />
      <ErrorNote error={graph.error} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {empty ? <div className="p-8"><Empty>The map is empty at this point. Add an entry to begin.</Empty></div> : null}
          <GraphCanvas elements={elements} selected={selected} highlight={highlight} onSelect={select} />
          <Legend />
        </div>
        {selected ? (
          <aside className="w-96 shrink-0 overflow-auto border-l border-stone-200 bg-white">
            <NodePanel id={selected} labels={labels} readOnly={index !== undefined} onChanged={() => (graph.reload(), positions.reload())} onHighlight={setHighlight} navigate={props.navigate} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
