import { useEffect, useMemo, useState } from "react";
import type { Navigate } from "../App";
import { type MapGraphView, type ViewStatus, api } from "../api";
import { GraphCanvas } from "../components/GraphCanvas";
import { GraphKey } from "../components/GraphKey";
import { Empty, ErrorNote } from "../components/ui";
import { toElements } from "../lib/elements";
import { labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useLive } from "../lib/useLive";
import { EdgePanel } from "./EdgePanel";
import { NodePanel } from "./NodePanel";
import { type Reviewed, UndoBar } from "./ReviewControls";
import { ReviewPanel, queueSize, reviewQueue } from "./ReviewPanel";
import { SelectionPanel } from "./SelectionPanel";
import { StatusBar } from "./StatusBar";
import { TimeBar } from "./TimeBar";

export const DEFAULT_FILTER: ViewStatus[] = ["proposed", "approved", "parked"];

/** The materialized View (now or at a past position), kept live. Everything renders from it. */
function useMapData(index: number | undefined, filter: ViewStatus[]) {
  const [version, setVersion] = useState("");
  const positions = useAsync(api.positions);
  const status = useAsync(api.status);
  const position = index === undefined ? undefined : positions.data?.[index];
  const view = useAsync(() => api.view(filter, position), [position, filter.join()]);
  const duplicates = useAsync(api.duplicates);
  const schema = status.data?.schema ?? null;
  const elements = useMemo(() => (view.data ? toElements(view.data, schema) : []), [view.data, schema]);
  const labels = useMemo(() => (view.data ? labelsFrom(view.data) : {}), [view.data]);
  const refresh = () => {
    view.reload();
    positions.reload();
    duplicates.reload();
  };
  useLive((head) => {
    setVersion(head);
    positions.reload();
    duplicates.reload();
    if (index === undefined) view.reload();
  });
  return { version, positions, view: view.data, error: view.error, duplicates: duplicates.data, schema, elements, labels, refresh };
}

interface PanelProps {
  mode: "items" | "review";
  selection: string[];
  view?: MapGraphView;
  duplicates?: ReturnType<typeof useMapData>["duplicates"];
  filter: ViewStatus[];
  labels: Record<string, string>;
  version: string;
  readOnly: boolean;
  onSelect: (ids: string[]) => void;
  onReviewed: (done: Reviewed) => void;
  onHighlight: (ids: string[]) => void;
  onCloseReview: () => void;
  navigate: Navigate;
}

/** Review queue, one Node, one Edge, or the selection: exactly one panel at a time. */
function SidePanel(props: PanelProps) {
  const content = panelFor(props);
  return content ? <aside className="w-96 shrink-0 overflow-auto border-l border-stone-200 bg-white">{content}</aside> : null;
}

function panelFor(props: PanelProps) {
  if (props.mode === "review") {
    return <ReviewPanel view={props.view} duplicates={props.duplicates} labels={props.labels} onFocus={props.onSelect} onDone={props.onReviewed} onClose={props.onCloseReview} />;
  }
  const { selection } = props;
  if (selection.length === 0) return null;
  const only = selection.length === 1 ? selection[0] : "";
  const common = { labels: props.labels, readOnly: props.readOnly, version: props.version, onReviewed: props.onReviewed, navigate: props.navigate, onSelect: (id: string) => props.onSelect([id]) };
  if (props.view?.nodes[only]) return <NodePanel id={only} {...common} statuses={props.filter} onChanged={() => props.onReviewed({ kind: "approve", ids: [] })} onHighlight={props.onHighlight} />;
  if (props.view?.edges[only]) return <EdgePanel id={only} {...common} />;
  const changes = [...new Map(selection.flatMap((id) => props.view?.changes[id] ?? []).map((c) => [c.event.id, c])).values()];
  return <SelectionPanel ids={selection} version={props.version} changes={changes} labels={props.labels} onClear={() => props.onSelect([])} onFocus={(id) => props.onSelect([id])} onDone={props.onReviewed} />;
}

export function MapView(props: { focus?: string; navigate: Navigate }) {
  const [selection, setSelection] = useState<string[]>(props.focus ? props.focus.split(",") : []);
  const [index, setIndex] = useState<number>();
  const [highlight, setHighlight] = useState<string[]>([]);
  const [filter, setFilter] = useState<ViewStatus[]>(DEFAULT_FILTER);
  const [mode, setMode] = useState<"items" | "review">("items");
  const [reviewed, setReviewed] = useState<Reviewed>();
  const { version, positions, view, error, duplicates, schema, elements, labels, refresh } = useMapData(index, filter);
  const queue = reviewQueue(view, duplicates);
  const empty = view && Object.keys(view.nodes).length === 0;

  const [synced, setSynced] = useState(0);
  const changeSelection = (ids: string[]) => {
    setSelection(ids);
    setHighlight([]);
    if (ids.length > 0) setMode("items");
    api
      .setSelection(ids)
      .then(() => setSynced((n) => n + 1))
      .catch(() => undefined);
  };
  const onReviewed = (done: Reviewed) => {
    setReviewed(done.kind === "decline" ? done : undefined);
    refresh();
  };
  const undoDecline = () => {
    const ids = reviewed?.ids ?? [];
    setReviewed(undefined);
    Promise.all(ids.map((id) => api.restore(id).catch(() => undefined))).then(refresh);
  };

  // A selection handed over by another view (e.g. "Show on map") is shared too.
  useEffect(() => {
    if (selection.length > 0) changeSelection(selection);
  }, []);

  // Items can leave the View (declined, filtered out, merged away): keep the selection to what is shown.
  useEffect(() => {
    if (!view) return;
    const kept = selection.filter((id) => view.nodes[id] || view.edges[id]);
    if (kept.length !== selection.length) changeSelection(kept);
  }, [view]);

  return (
    <div className="flex h-full flex-col">
      <TimeBar positions={positions.data ?? []} index={index} onChange={setIndex} onReverted={refresh} />
      <StatusBar counts={view?.counts} filter={filter} onFilter={setFilter} toReview={index === undefined ? queueSize(queue) : 0} onReview={() => setMode(mode === "review" ? "items" : "review")} />
      <ErrorNote error={error} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {empty ? <div className="absolute inset-x-0 top-0 z-10 p-8"><Empty>Nothing to show with these filters. Add an entry, or show more statuses.</Empty></div> : null}
          <GraphCanvas elements={elements} selection={selection} highlight={highlight} onSelectionChange={changeSelection} />
          <GraphKey schema={schema} />
          <UndoBar done={reviewed} onUndo={undoDecline} onClose={() => setReviewed(undefined)} />
        </div>
        <SidePanel
          mode={mode}
          selection={selection}
          view={view}
          duplicates={duplicates}
          filter={filter}
          labels={labels}
          version={`${version}:${synced}`}
          readOnly={index !== undefined}
          onSelect={changeSelection}
          onReviewed={onReviewed}
          onHighlight={setHighlight}
          onCloseReview={() => setMode("items")}
          navigate={props.navigate}
        />
      </div>
    </div>
  );
}
