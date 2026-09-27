// The app shell: conversations on the left (hover to open), the conversation in the middle,
// and one view beside it (map, loops, entries, log) chosen from the right rail. The map
// selection lives here so the chat can say "these" and a highlight can show its item.
import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { type Selection, api } from "./api";
import { ChatRail } from "./chat/ChatRail";
import { ChatView } from "./chat/ChatView";
import { SettingsDialog } from "./chat/SettingsDialog";
import { Divider, usePaneWidth } from "./components/Divider";
import { type PaneName, ViewRail } from "./components/ViewRail";
import { labelsFrom } from "./lib/format";
import { ItemsProvider } from "./lib/items";
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

const newChatId = () => globalThis.crypto.randomUUID();

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

/** Every item and how its kind looks, kept live, so chips and tool cards name what they touched. */
function useMapItems() {
  const view = useAsync(() => api.view(["active", "removed"]));
  const schema = useAsync(api.schema);
  useLive(view.reload);
  const items = useMemo(() => ({ view: view.data, schema: schema.data ?? null }), [view.data, schema.data]);
  const labels = useMemo(() => (view.data ? labelsFrom(view.data) : {}), [view.data]);
  return { items, labels };
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

/** The chat and the view beside it. One side always stays open: hiding the chat shows a view,
 *  closing the last view shows the chat, and opening a conversation shows it again. */
function useSides(pane: ViewName | undefined, setPane: (pane: ViewName | undefined) => void, chats: ReturnType<typeof useChats>) {
  const [chatOpen, setChatOpen] = useState(true);
  const toggleChat = () => {
    if (chatOpen && !pane) setPane("map");
    setChatOpen(!chatOpen);
  };
  const togglePane = (view: ViewName) => {
    const next = view === pane ? undefined : view;
    if (!next) setChatOpen(true);
    setPane(next);
  };
  const openChat = (id: string) => {
    chats.setActive(id);
    setChatOpen(true);
  };
  const newChat = () => {
    chats.fresh();
    setChatOpen(true);
  };
  return { chatOpen, toggleChat, togglePane, openChat, newChat };
}

export function App() {
  const [pane, setPane] = useState<ViewName | undefined>("map");
  const [focus, setFocus] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useAsync(api.chatSettings);
  const { selection, select } = useSelection();
  const { items, labels } = useMapItems();
  const chats = useChats();
  const width = usePaneWidth();
  const { chatOpen, toggleChat, togglePane, openChat, newChat } = useSides(pane, setPane, chats);

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
    <ItemsProvider value={items}>
    <div className="flex h-screen bg-paper text-stone-800">
      <ChatRail chats={chats.list} active={chats.active} onOpen={openChat} onNew={newChat} onRename={chats.rename} onDelete={chats.remove} onSettings={() => setSettingsOpen(true)} chatOpen={chatOpen} onToggleChat={toggleChat} />
      <main aria-label="Conversation" className={chatOpen ? "min-w-panel flex-1" : "hidden"}>
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
        <ViewPane chatOpen={chatOpen} share={width.share} onResize={width.set}>
          <CurrentView view={pane} focus={focus} selection={selection} onSelect={select} navigate={navigate} />
        </ViewPane>
      ) : null}
      <ViewRail active={pane} onToggle={togglePane} />
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
    </ItemsProvider>
  );
}

/** The view beside the chat, sized by the divider; alone, it takes the whole width. */
function ViewPane(props: { chatOpen: boolean; share: number; onResize: (share: number) => void; children: ReactElement }) {
  const style = props.chatOpen ? ({ "--share": props.share } as CSSProperties) : undefined;
  return (
    <>
      {props.chatOpen ? <Divider share={props.share} onChange={props.onResize} /> : null}
      <section aria-label="View" style={style} className={`min-w-0 overflow-hidden bg-stone-50 ${props.chatOpen ? "basis-share shrink-0" : "flex-1"}`}>
        <div className="h-full overflow-auto">{props.children}</div>
      </section>
    </>
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
