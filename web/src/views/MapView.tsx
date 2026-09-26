import { useMemo, useState } from "react";
import type { Navigate } from "../App";
import { type Graph, type Schema, api } from "../api";
import { GraphCanvas } from "../components/GraphCanvas";
import { Button, Empty, ErrorNote } from "../components/ui";
import { humanise, toElements } from "../lib/elements";
import { colorFor, formatHlc, labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useLive } from "../lib/useLive";
import { NodePanel } from "./NodePanel";
import { SelectionPanel } from "./SelectionPanel";

function loadGraph(position: string | undefined): Promise<Graph> {
  return position ? api.graphAt(position).then((g) => g.graph) : api.graph();
}

function TimeBar(props: { positions: string[]; index: number | undefined; onChange: (index: number | undefined) => void }) {
  const { positions, index, onChange } = props;
  const last = positions.length - 1;
  return (
    <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-2 text-sm">
      <span className="w-40 shrink-0 text-stone-500">{index === undefined ? "Now · live" : formatHlc(positions[index])}</span>
      <input aria-label="Time travel" type="range" className="flex-1 accent-stone-700" min={0} max={Math.max(last, 0)} value={index ?? last} onChange={(e) => onChange(Number(e.target.value) === last ? undefined : Number(e.target.value))} />
      <Button disabled={index === undefined} onClick={() => onChange(undefined)}>Now</Button>
    </div>
  );
}

const SHAPE_CLASS: Record<string, string> = {
  ellipse: "rounded-full",
  "round-rectangle": "rounded-sm w-5",
  "round-diamond": "rotate-45 rounded-[2px] scale-75",
};

export function Legend(props: { schema: Schema | null }) {
  const types = Object.entries(props.schema?.nodeTypes ?? {});
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-stone-200 bg-stone-50 px-5 py-1.5 text-xs text-stone-600">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {types.map(([name, def]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 ${SHAPE_CLASS[def.display?.shape ?? "ellipse"] ?? "rounded"}`} style={{ backgroundColor: def.display?.color ?? colorFor(name, props.schema) }} />
            {humanise(name)}
          </span>
        ))}
      </div>
      <p className="text-stone-400">
        drag to select · shift-click to add · scroll to pan · pinch to zoom · green halo = just changed
      </p>
    </div>
  );
}

function SidePanel(props: { selection: string[]; labels: Record<string, string>; children: React.ReactNode; onClear: () => void }) {
  if (props.selection.length === 0) return null;
  const single = props.selection.length === 1 && props.labels[props.selection[0]] !== undefined;
  return (
    <aside className="w-96 shrink-0 overflow-auto border-l border-stone-200 bg-white">
      {single ? props.children : <SelectionPanel ids={props.selection} onClear={props.onClear} />}
    </aside>
  );
}

export function MapView(props: { focus?: string; navigate: Navigate }) {
  const [selection, setSelection] = useState<string[]>(props.focus ? [props.focus] : []);
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
  const [version, setVersion] = useState("");

  useLive((head) => {
    setVersion(head);
    positions.reload();
    if (index === undefined) graph.reload();
  });

  const changeSelection = (ids: string[]) => {
    setSelection(ids);
    setHighlight([]);
    api.setSelection(ids).catch(() => undefined);
  };

  return (
    <div className="flex h-full flex-col">
      <TimeBar positions={positions.data ?? []} index={index} onChange={setIndex} />
      <Legend schema={schema} />
      <ErrorNote error={graph.error} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {empty ? <div className="absolute inset-x-0 top-0 z-10 p-8"><Empty>The map is empty at this point. Add an entry to begin.</Empty></div> : null}
          <GraphCanvas elements={elements} selection={selection} highlight={highlight} onSelectionChange={changeSelection} />
        </div>
        <SidePanel selection={selection} labels={labels} onClear={() => changeSelection([])}>
          <NodePanel id={selection[0]} labels={labels} readOnly={index !== undefined} version={version} onChanged={() => (graph.reload(), positions.reload())} onHighlight={setHighlight} navigate={props.navigate} />
        </SidePanel>
      </div>
    </div>
  );
}
