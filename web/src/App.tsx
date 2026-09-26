// The app shell: conversations on the left (hover to open), the conversation in the middle,
// and one view beside it (map, loops, entries, log) chosen from the right rail. The map
// selection lives here so the chat can say "these" and a highlight can show its item.
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { type Selection, api } from "./api";
import { ChatRail } from "./chat/ChatRail";
import { ChatView } from "./chat/ChatView";
import { SettingsDialog } from "./chat/SettingsDialog";
import { type PaneName, ViewRail } from "./components/ViewRail";
import { labelsFrom } from "./lib/format";
import { useAsync } from "./lib/useAsync";
import { useLive } from "./lib/useLive";
import { EntriesView } from "./views/EntriesView";
import { LogView } from "./views/LogView";
import { LoopsView } from "./views/LoopsView";
import { MapView } from "./views/MapView";

export type ViewName = PaneName;

export interface Navigate {
  (view: ViewName, focus?: string): void;
}

const EMPTY: Selection = { ids: [], at: "", items: [] };

export const newChatId = () => globalThis.crypto.randomUUID();

/** The shared map selection: set locally at once, then as the server resolves it. */
function useSelection() {
  const [selection, setSelection] = useState<Selection>(EMPTY);
  useEffect(() => {
    api.selection().then(setSelection, () => undefined);
  }, []);
  const select = useCallback((ids: string[]) => {
    setSelection((s) => ({ ...s, ids, items: s.items.filter((i) => ids.includes(i.id)) }));
    api.setSelection(ids).then(setSelection, () => undefined);
  }, []);
  return { selection, select };
}

/** Names for every item, kept live, so tool cards can say what they touched. */
function useLabels() {
  const view = useAsync(() => api.view(["active", "removed"]));
  useLive(view.reload);
  return useMemo(() => (view.data ? labelsFrom(view.data) : {}), [view.data]);
}

function useChats() {
  const [active, setActive] = useState<string>(newChatId);
  const chats = useAsync(api.chats);
  const remove = (id: string) =>
    api.deleteChat(id).then(() => {
      if (id === active) setActive(newChatId());
      chats.reload();
    });
  const rename = (id: string, title: string) => api.renameChat(id, title).then(chats.reload);
  return { active, setActive, list: chats.data ?? [], reload: chats.reload, remove, rename, fresh: () => setActive(newChatId()) };
}

export function App() {
  const [pane, setPane] = useState<ViewName | undefined>("map");
  const [focus, setFocus] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useAsync(api.chatSettings);
  const { selection, select } = useSelection();
  const labels = useLabels();
  const chats = useChats();

  const navigate: Navigate = (next, focusId) => {
    if (next === "map" && focusId) select(focusId.split(","));
    setFocus(next === "map" ? undefined : focusId);
    setPane(next);
  };
  const showOnMap = (ids: string[]) => {
    select(ids);
    setPane("map");
  };
  return (
    <div className="flex h-screen bg-paper text-stone-800">
      <ChatRail chats={chats.list} active={chats.active} onOpen={chats.setActive} onNew={chats.fresh} onRename={chats.rename} onDelete={chats.remove} onSettings={() => setSettingsOpen(true)} />
      <main className="min-w-[22rem] flex-1">
        <ChatView
          id={chats.active}
          selection={selection.items}
          settings={settings.data}
          labels={labels}
          onSelect={showOnMap}
          onOpenEntry={(entry) => navigate("entries", entry)}
          onNewChat={chats.fresh}
          onOpenSettings={() => setSettingsOpen(true)}
          onTurnEnd={chats.reload}
          onDeselect={(id) => select(selection.ids.filter((i) => i !== id))}
          onClearSelection={() => select([])}
        />
      </main>
      {pane ? (
        <section aria-label="View" className="min-w-0 basis-[56%] overflow-hidden border-l border-stone-200/70 bg-stone-50">
          <div className="h-full overflow-auto">
            <CurrentView view={pane} focus={focus} selection={selection} onSelect={select} navigate={navigate} />
          </div>
        </section>
      ) : null}
      <ViewRail active={pane} onToggle={(v) => setPane(v === pane ? undefined : v)} />
      {settingsOpen && settings.data ? (
        <SettingsDialog
          settings={settings.data}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            settings.reload();
            setSettingsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function CurrentView(props: { view: ViewName; focus?: string; selection: Selection; onSelect: (ids: string[]) => void; navigate: Navigate }) {
  const views: Record<ViewName, () => ReactElement> = {
    map: () => <MapView selection={props.selection.ids} synced={props.selection.at} onSelect={props.onSelect} navigate={props.navigate} />,
    loops: () => <LoopsView navigate={props.navigate} />,
    entries: () => <EntriesView key={props.focus} focus={props.focus} navigate={props.navigate} />,
    log: () => <LogView />,
  };
  return views[props.view]();
}
