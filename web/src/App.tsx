import { type ReactElement, useState } from "react";
import { api } from "./api";
import { useAsync } from "./lib/useAsync";
import { EntriesView } from "./views/EntriesView";
import { LogView } from "./views/LogView";
import { LoopsView } from "./views/LoopsView";
import { MapView } from "./views/MapView";
import { WriteView } from "./views/WriteView";

export type ViewName = "map" | "write" | "loops" | "entries" | "log";

export interface Navigate {
  (view: ViewName, focus?: string): void;
}

const NAV: { view: ViewName; label: string; hint: string }[] = [
  { view: "map", label: "Map", hint: "The graph, now or at any time; review proposals here" },
  { view: "write", label: "Write", hint: "Add an entry" },
  { view: "loops", label: "Loops", hint: "Feedback cycles" },
  { view: "entries", label: "Entries", hint: "Your writing and its evidence" },
  { view: "log", label: "Log", hint: "Every change, with who made it" },
];

function NavButton(props: { item: (typeof NAV)[number]; active: boolean; onClick: () => void }) {
  const { item, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.hint}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${active ? "bg-stone-800 text-stone-50" : "text-stone-600 hover:bg-stone-200/70"}`}
    >
      <span>{item.label}</span>
    </button>
  );
}

function HostedNotice(props: { hosted?: boolean; model?: string }) {
  if (!props.hosted) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      Interpretation uses a hosted model ({props.model}); entry text leaves this device.
    </div>
  );
}

export function App() {
  const [view, setView] = useState<ViewName>("map");
  const [focus, setFocus] = useState<string>();
  const status = useAsync(api.status);
  const navigate: Navigate = (next, focusId) => {
    setFocus(focusId);
    setView(next);
  };
  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-stone-200 bg-stone-100/60 p-4">
        <h1 className="mb-4 px-3 font-serif text-lg text-stone-800">Inner Graph</h1>
        {NAV.map((item) => (
          <NavButton key={item.view} item={item} active={view === item.view} onClick={() => navigate(item.view)} />
        ))}
        <p className="mt-auto px-3 text-xs text-stone-400">
          {status.data?.schema ? `${status.data.schema.name} v${status.data.schema.version}` : ""} · {status.data?.model}
        </p>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <HostedNotice hosted={status.data?.hosted} model={status.data?.model} />
        <div className="min-h-0 flex-1 overflow-auto">
          <CurrentView view={view} focus={focus} navigate={navigate} />
        </div>
      </main>
    </div>
  );
}

function CurrentView(props: { view: ViewName; focus?: string; navigate: Navigate }) {
  const views: Record<ViewName, () => ReactElement> = {
    write: () => <WriteView navigate={props.navigate} />,
    map: () => <MapView focus={props.focus} navigate={props.navigate} />,
    loops: () => <LoopsView navigate={props.navigate} />,
    entries: () => <EntriesView focus={props.focus} navigate={props.navigate} />,
    log: () => <LogView />,
  };
  return views[props.view]();
}
