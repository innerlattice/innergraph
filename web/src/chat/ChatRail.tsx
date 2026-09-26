// The left rail: a slim strip that opens on hover to show conversations, a new one, and settings.
import { MessageCircle, Plus, Settings, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ChatListItem } from "../api";

export interface ChatRailProps {
  chats: ChatListItem[];
  active?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}

/** "just now", "3h ago", "2d ago", or the date. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RailButton(props: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} aria-label={props.label} className="flex h-9 w-full items-center gap-3 rounded-xl px-2.5 text-sm text-stone-600 transition hover:bg-stone-200/70 hover:text-stone-900">
      <span className="shrink-0">{props.icon}</span>
      <span className="truncate opacity-0 transition-opacity group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">{props.label}</span>
    </button>
  );
}

function ChatRow(props: { chat: ChatListItem; active: boolean } & Pick<ChatRailProps, "onOpen" | "onRename" | "onDelete">) {
  const { chat } = props;
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        aria-label="Conversation title"
        defaultValue={chat.title}
        // biome-ignore lint/a11y/noAutofocus: renaming starts where the person double-clicked
        autoFocus
        onBlur={(e) => (props.onRename(chat.id, e.target.value), setEditing(false))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none"
      />
    );
  }
  return (
    <div className={`group/row flex items-center rounded-lg transition ${props.active ? "bg-white shadow-sm" : "hover:bg-stone-200/60"}`}>
      <button type="button" onClick={() => props.onOpen(chat.id)} onDoubleClick={() => setEditing(true)} title="Double-click to rename" className="min-w-0 flex-1 px-2.5 py-1.5 text-left">
        <span className="block truncate text-sm text-stone-700">{chat.title}</span>
        <span className="block text-[11px] text-stone-400">
          {ago(chat.updatedAt)}
          {chat.budget.level === "full" ? " · full" : ""}
        </span>
      </button>
      <button type="button" aria-label={`Delete ${chat.title}`} onClick={() => props.onDelete(chat.id)} className="mr-1 rounded-md p-1.5 text-stone-400 opacity-0 transition group-hover/row:opacity-100 hover:bg-stone-200 hover:text-rose-600">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function ChatRail(props: ChatRailProps) {
  return (
    <div className="relative w-14 shrink-0">
      <nav
        aria-label="Conversations"
        className="group/rail absolute inset-y-0 left-0 z-40 flex w-14 flex-col gap-1 overflow-hidden border-r border-stone-200/70 bg-stone-100/95 px-2 py-4 backdrop-blur transition-[width,box-shadow] duration-200 hover:w-72 hover:shadow-2xl focus-within:w-72"
      >
        <div className="mb-3 flex h-8 items-center gap-3 px-2.5">
          <span className="h-3 w-3 shrink-0 rounded-full bg-clay-400" />
          <span className="whitespace-nowrap font-serif text-lg text-stone-800 opacity-0 transition-opacity group-hover/rail:opacity-100">Inner Graph</span>
        </div>
        <RailButton icon={<Plus size={18} />} label="New conversation" onClick={props.onNew} />
        <div className="mt-3 flex items-center gap-3 px-2.5 text-stone-400">
          <MessageCircle size={18} className="shrink-0" />
          <span className="text-xs tracking-wide uppercase opacity-0 transition-opacity group-hover/rail:opacity-100">Conversations</span>
        </div>
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto opacity-0 transition-opacity group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          {props.chats.length === 0 ? <p className="px-2.5 py-2 text-xs whitespace-nowrap text-stone-400">Nothing here yet.</p> : null}
          {props.chats.map((chat) => (
            <ChatRow key={chat.id} chat={chat} active={chat.id === props.active} onOpen={props.onOpen} onRename={props.onRename} onDelete={props.onDelete} />
          ))}
        </div>
        <RailButton icon={<Settings size={18} />} label="Settings" onClick={props.onSettings} />
      </nav>
    </div>
  );
}
