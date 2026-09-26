import { useEffect, useMemo, useState } from "react";
import type { Navigate } from "../App";
import { type AnyEvent, type Graph, type PendingChanges, type PendingItem, type Schema, api } from "../api";
import { GraphCanvas } from "../components/GraphCanvas";
import { Empty, ErrorNote } from "../components/ui";
import { humanise, toElements } from "../lib/elements";
import { colorFor, labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useLive } from "../lib/useLive";
import { NodePanel } from "./NodePanel";
import { EdgePanel } from "./EdgePanel";
import { ProposedPanel, ReviewBar, type Reviewed, UndoBar, pendingFor } from "./ReviewControls";
import { SelectionPanel } from "./SelectionPanel";
import { TimeBar } from "./TimeBar";

/** Graphs always come back whole; declined (superseded) items are hidden unless asked for. */
function loadGraph(position: string | undefined): Promise<Graph> {
  return position ? api.graphAt(position).then((g) => g.graph) : api.graph(true);
}

export function visible(graph: Graph, showDeclined: boolean): Graph {
  if (showDeclined) return graph;
  const nodes = Object.fromEntries(Object.entries(graph.nodes).filter(([, n]) => n.status !== "superseded"));
  const edges = Object.fromEntries(Object.entries(graph.edges).filter(([, e]) => e.status !== "superseded" && nodes[e.from] && nodes[e.to]));
  return { nodes, edges };
}

const SHAPE_CLASS: Record<string, string> = {
  ellipse: "rounded-full",
  "round-rectangle": "rounded-sm w-5",
  "round-diamond": "rotate-45 rounded-[2px] scale-75",
};

export function Legend(props: { schema: Schema | null; showDeclined: boolean; onToggle: (show: boolean) => void }) {
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
      <p className="flex items-center gap-3 text-stone-400">
        <span>drag to select · shift-click to add · scroll to pan · pinch to zoom · green halo = just changed</span>
        <label className="flex items-center gap-1 text-stone-600">
          <input type="checkbox" checked={props.showDeclined} onChange={(e) => props.onToggle(e.target.checked)} />
          Show declined
        </label>
      </p>
    </div>
  );
}

const NONE: PendingItem[] = [];

interface PanelProps {
  selection: string[];
  graph?: Graph;
  proposed: PendingItem[];
  pending?: PendingChanges;
  labels: Record<string, string>;
  version: string;
  readOnly: boolean;
  onClear: () => void;
  onSelect: (ids: string[]) => void;
  onReviewed: (done: Reviewed) => void;
  onHighlight: (ids: string[]) => void;
  navigate: Navigate;
}

/** One Node or Edge → its panel; one proposed item → the proposal; anything else → the selection. */
function SidePanel(props: PanelProps) {
  const { selection } = props;
  if (selection.length === 0) return null;
  return <aside className="w-96 shrink-0 overflow-auto border-l border-stone-200 bg-white">{panelFor(props, selection)}</aside>;
}

function panelFor(props: PanelProps, selection: string[]) {
  const only = selection.length === 1 ? selection[0] : "";
  const proposed = props.proposed.find((p) => p.item.id === only);
  const shared = { labels: props.labels, readOnly: props.readOnly, version: props.version, pending: pendingFor(props.pending, only), onReviewed: props.onReviewed, navigate: props.navigate };
  if (props.graph?.nodes[only]) return <NodePanel id={only} {...shared} onChanged={() => props.onReviewed({ kind: "approve", ids: [] })} onHighlight={props.onHighlight} onSelect={(id) => props.onSelect([id])} />;
  if (props.graph?.edges[only]) return <EdgePanel id={only} {...shared} onSelect={(id) => props.onSelect([id])} />;
  if (proposed) return <ProposedPanel item={proposed} labels={props.labels} onDone={props.onReviewed} />;
  const pending = [...new Map(selection.flatMap((id) => pendingFor(props.pending, id)).map((i) => [i.event.id, i])).values()];
  return <SelectionPanel ids={selection} version={props.version} pending={pending} labels={props.labels} onClear={props.onClear} onDone={props.onReviewed} />;
}

/** Graph (now or at a past position), proposals, labels and elements, kept live. */
function useMapData(index: number | undefined, showDeclined: boolean) {
  const [version, setVersion] = useState("");
  const positions = useAsync(api.positions);
  const status = useAsync(api.status);
  const position = index === undefined ? undefined : positions.data?.[index];
  const loaded = useAsync(() => loadGraph(position), [position]);
  const graph = useMemo(() => (loaded.data ? visible(loaded.data, showDeclined) : undefined), [loaded.data, showDeclined]);
  const pending = useAsync(api.pending);
  const proposed = useMemo(() => (position === undefined ? (pending.data?.assertions ?? NONE) : NONE), [pending.data, position]);
  const schema = status.data?.schema ?? null;
  const elements = useMemo(() => (graph ? toElements(graph, schema, proposed) : []), [graph, schema, proposed]);
  const labels = useMemo(() => (graph ? labelsFrom(graph, proposed.map(asEvent)) : {}), [graph, proposed]);
  const refresh = () => {
    loaded.reload();
    pending.reload();
    positions.reload();
  };
  useLive((head) => {
    setVersion(head);
    positions.reload();
    pending.reload();
    if (index === undefined) loaded.reload();
  });
  return { version, positions, graph, error: loaded.error, pending: pending.data, proposed, schema, elements, labels, refresh };
}

export function MapView(props: { focus?: string; navigate: Navigate }) {
  const [selection, setSelection] = useState<string[]>(props.focus ? props.focus.split(",") : []);
  const [index, setIndex] = useState<number>();
  const [highlight, setHighlight] = useState<string[]>([]);
  const [showDeclined, setShowDeclined] = useState(false);
  const [reviewed, setReviewed] = useState<Reviewed>();
  const { version, positions, graph, error, pending, proposed, schema, elements, labels, refresh } = useMapData(index, showDeclined);
  const empty = graph && Object.keys(graph.nodes).length === 0 && proposed.length === 0;
  const onReviewed = (done: Reviewed) => {
    setReviewed(done.kind === "decline" ? done : undefined);
    refresh();
  };
  const undoDecline = () => {
    const ids = reviewed?.ids ?? [];
    setReviewed(undefined);
    Promise.all(ids.map((id) => api.restore(id).catch(() => undefined))).then(refresh);
  };

  const [synced, setSynced] = useState(0);
  const changeSelection = (ids: string[]) => {
    setSelection(ids);
    setHighlight([]);
    api
      .setSelection(ids)
      .then(() => setSynced((n) => n + 1))
      .catch(() => undefined);
  };

  // A selection handed over by another view (e.g. "Show on map") is shared too.
  useEffect(() => {
    if (selection.length > 0) changeSelection(selection);
  }, []);

  // Items can leave the graph (declined, merged away): keep the selection to what still exists.
  useEffect(() => {
    if (!graph) return;
    const present = new Set(elements.map((e) => String(e.data.id)));
    const kept = selection.filter((id) => present.has(id));
    if (kept.length !== selection.length) changeSelection(kept);
  }, [elements]);

  return (
    <div className="flex h-full flex-col">
      <TimeBar positions={positions.data ?? []} index={index} onChange={setIndex} onReverted={refresh} />
      <Legend schema={schema} showDeclined={showDeclined} onToggle={setShowDeclined} />
      {index === undefined ? <ReviewBar proposed={proposed} pending={pending} graph={graph} onSelect={changeSelection} /> : null}
      <ErrorNote error={error} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {empty ? <div className="absolute inset-x-0 top-0 z-10 p-8"><Empty>The map is empty at this point. Add an entry to begin.</Empty></div> : null}
          <GraphCanvas elements={elements} selection={selection} highlight={highlight} onSelectionChange={changeSelection} />
          <UndoBar done={reviewed} onUndo={undoDecline} onClose={() => setReviewed(undefined)} />
        </div>
        <SidePanel
          selection={selection}
          graph={graph}
          proposed={proposed}
          pending={pending}
          labels={labels}
          version={`${version}:${synced}`}
          readOnly={index !== undefined}
          onClear={() => changeSelection([])}
          onSelect={changeSelection}
          onReviewed={onReviewed}
          onHighlight={setHighlight}
          navigate={props.navigate}
        />
      </div>
    </div>
  );
}

/** Proposed nodes contribute their labels, via the same shape as NodeAsserted events. */
function asEvent(p: PendingItem): AnyEvent {
  return { type: p.kind === "node" ? "NodeAsserted" : "EdgeAsserted", body: p.item } as unknown as AnyEvent;
}
