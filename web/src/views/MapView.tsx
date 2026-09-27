import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Navigate } from "../App";
import { type GraphView, type Schema, type ViewStatus, api } from "../api";
import { GraphCanvas } from "../components/GraphCanvas";
import { GraphKey } from "../components/GraphKey";
import { Empty, ErrorNote } from "../components/ui";
import { toElements } from "../lib/elements";
import { labelsFrom } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useLive } from "../lib/useLive";
import { searchHits } from "../lib/search";
import { ChangesPanel } from "./ChangesPanel";
import { EdgePanel } from "./EdgePanel";
import { type Done, UndoBar } from "./ItemControls";
import { NodePanel } from "./NodePanel";
import { SelectionPanel } from "./SelectionPanel";
import { StatusBar } from "./StatusBar";
import { TimeBar } from "./TimeBar";

const statusesFor = (showRemoved: boolean): ViewStatus[] => (showRemoved ? ["active", "removed"] : ["active"]);

/** The materialized View (now or at a past position), kept live. Everything renders from it. */
function useMapData(index: number | undefined, filter: ViewStatus[]) {
  const [version, setVersion] = useState("");
  const positions = useAsync(api.positions);
  const schemaState = useAsync(api.schema);
  const position = index === undefined ? undefined : positions.data?.[index];
  const view = useAsync(() => api.view(filter, position), [position, filter.join()]);
  const duplicates = useAsync(api.duplicates);
  const schema = schemaState.data ?? null;
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
  mode: "items" | "changes";
  selection: string[];
  view?: GraphView;
  duplicates?: ReturnType<typeof useMapData>["duplicates"];
  filter: ViewStatus[];
  labels: Record<string, string>;
  version: string;
  readOnly: boolean;
  onSelect: (ids: string[]) => void;
  onDone: (done: Done) => void;
  onHighlight: (ids: string[]) => void;
  onCloseChanges: () => void;
  navigate: Navigate;
  schema: Schema | null;
}

/** History, one Node, one Edge, or the selection: exactly one card at a time, floating over
 *  the map so the conversation keeps its room. */
function SidePanel(props: PanelProps & { panel: RefObject<HTMLElement | null> }) {
  const content = panelFor(props);
  if (!content) return null;
  return (
    <aside
      ref={props.panel}
      className="absolute top-3 right-3 z-20 max-h-inset w-panel max-w-inset animate-rise overflow-auto rounded-2xl bg-white/95 shadow-floating backdrop-blur"
    >
      {content}
    </aside>
  );
}

function panelFor(props: PanelProps) {
  if (props.mode === "changes") {
    return (
      <ChangesPanel
        version={props.version}
        duplicates={props.duplicates}
        labels={props.labels}
        onFocus={props.onSelect}
        onChanged={() => props.onDone({ kind: "confirm", ids: [] })}
        onClose={props.onCloseChanges}
      />
    );
  }
  const { selection } = props;
  if (selection.length === 0) return null;
  const only = selection.length === 1 ? selection[0] : "";
  const common = {
    schema: props.schema,
    labels: props.labels,
    readOnly: props.readOnly,
    version: props.version,
    onDone: props.onDone,
    navigate: props.navigate,
    onSelect: (id: string) => props.onSelect([id]),
  };
  if (props.view?.nodes[only]) return <NodePanel key={only} id={only} {...common} statuses={props.filter} onHighlight={props.onHighlight} />;
  if (props.view?.edges[only]) return <EdgePanel key={only} id={only} {...common} />;
  return <SelectionPanel ids={selection} version={props.version} onClear={() => props.onSelect([])} onFocus={(id) => props.onSelect([id])} onDone={props.onDone} />;
}

export interface MapViewProps {
  /** Shared with the conversation, which can refer to "these". */
  selection: string[];
  /** Changes whenever the server has stored a new selection. */
  synced: string;
  onSelect: (ids: string[]) => void;
  navigate: Navigate;
}

export function MapView(props: MapViewProps) {
  const { selection } = props;
  const [index, setIndex] = useState<number>();
  const [highlight, setHighlight] = useState<string[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const filter = statusesFor(showRemoved);
  const [mode, setMode] = useState<"items" | "changes">("items");
  const [done, setDone] = useState<Done>();
  const [tidied, setTidied] = useState(0);
  const [query, setQuery] = useState("");
  const { version, positions, view, error, duplicates, schema, elements, labels, refresh } = useMapData(index, filter);
  const empty = view && Object.keys(view.nodes).length === 0;
  const found = useMemo(() => (view ? searchHits(view, query) : null), [view, query]);
  const panel = useRef<HTMLElement>(null);

  const changeSelection = (ids: string[]) => {
    setHighlight([]);
    if (ids.length > 0) setMode("items");
    props.onSelect(ids);
  };
  const onDone = (next: Done) => {
    setDone(next.kind === "remove" ? next : undefined);
    refresh();
  };
  const undoRemove = () => {
    const ids = done?.ids ?? [];
    setDone(undefined);
    Promise.all(ids.map((id) => api.restore(id).catch(() => undefined))).then(refresh);
  };

  // Items can leave the View (removed, filtered out, merged away): keep the selection to what is shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: prune only when the view changes, not on every selection
  useEffect(() => {
    if (!view) return;
    const kept = selection.filter((id) => view.nodes[id] || view.edges[id]);
    if (kept.length !== selection.length) changeSelection(kept);
  }, [view]);

  return (
    <div className="flex h-full flex-col">
      <TimeBar positions={positions.data ?? []} index={index} onChange={setIndex} onReverted={refresh} />
      <StatusBar
        removed={view?.counts.removed}
        showRemoved={showRemoved}
        onShowRemoved={setShowRemoved}
        changesOpen={mode === "changes"}
        onChanges={() => setMode(mode === "changes" ? "items" : "changes")}
        duplicates={duplicates?.length ?? 0}
        query={query}
        onQuery={setQuery}
        found={found ? [...found].filter((id) => view?.nodes[id]).length : undefined}
        onTidy={() => setTidied(tidied + 1)}
      />
      <ErrorNote error={error} />
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          {empty ? (
            <div className="absolute inset-x-0 top-0 z-10 p-8">
              <Empty>Nothing on the map here yet. Add an entry to begin.</Empty>
            </div>
          ) : null}
          <GraphCanvas elements={elements} selection={selection} highlight={highlight} found={found} onSelectionChange={changeSelection} tidied={tidied} cover={panel} />
          <GraphKey schema={schema} />
          <UndoBar done={done} onUndo={undoRemove} onClose={() => setDone(undefined)} />
        </div>
        <SidePanel
          panel={panel}
          mode={mode}
          selection={selection}
          view={view}
          schema={schema}
          duplicates={duplicates}
          filter={filter}
          labels={labels}
          version={`${version}:${props.synced}`}
          readOnly={index !== undefined}
          onSelect={changeSelection}
          onDone={onDone}
          onHighlight={setHighlight}
          onCloseChanges={() => setMode("items")}
          navigate={props.navigate}
        />
      </div>
    </div>
  );
}
