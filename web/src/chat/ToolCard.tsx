// A tool call inline in the conversation: a quiet line for look-ups, a small well set into the page
// for changes, with the items it touched (click to see them on the map) and Undo. The record sits
// below the conversation's surface: someone talking through their life is reading the words, not
// the machinery.
import { Check, CircleAlert, Search, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Chip, ItemLabel } from "../components/Chip";
import { type ToolCardInfo, type ToolPart, describeTool } from "./parts";

export interface ToolCardProps {
  part: ToolPart;
  labels?: Record<string, string>;
  onSelect: (ids: string[]) => void;
  onOpenEntry: (entry: string) => void;
}

function Lookup(props: { info: ToolCardInfo }) {
  const { info } = props;
  return (
    <p className="flex items-center gap-2 py-0.5 text-xs text-stone-400">
      <Search size={12} className={info.phase === "running" ? "animate-pulse" : ""} />
      {info.title}
      {info.phase === "running" ? "…" : ""}
    </p>
  );
}

function CardIcon(props: { phase: ToolCardInfo["phase"]; undone: boolean }) {
  if (props.phase === "error") return <CircleAlert size={13} className="text-rose-500" />;
  if (props.phase === "running") return <Sparkles size={13} className="animate-pulse text-clay-500" />;
  return props.undone ? <Undo2 size={13} className="text-stone-400" /> : <Check size={13} className="text-sage-600" />;
}

function Chips(props: { info: ToolCardInfo; undone: boolean; onSelect: (ids: string[]) => void }) {
  if (props.info.items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {props.info.items.map((item) => (
        <Chip key={item.id} struck={props.undone} onClick={() => props.onSelect([item.id])}>
          <ItemLabel label={item.label} />
        </Chip>
      ))}
    </div>
  );
}

function UndoButton(props: { session?: string; undone: boolean; onUndone: () => void; onError: (message: string) => void }) {
  if (!props.session || props.undone) return props.undone ? <span className="text-xs text-stone-400">Undone</span> : null;
  const undo = () =>
    api
      .undoSession(props.session as string)
      .then(props.onUndone)
      .catch((e: Error) => props.onError(e.message));
  return (
    <button type="button" onClick={undo} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-stone-500 transition hover:bg-white/70 hover:text-stone-800">
      <Undo2 size={12} /> Undo
    </button>
  );
}

export function ToolCard(props: ToolCardProps) {
  const [undone, setUndone] = useState(false);
  const [failure, setFailure] = useState<string>();
  const info = describeTool(props.part, props.labels);
  if (info.quiet) return <Lookup info={info} />;
  const title = info.entry && !undone ? (
    <button type="button" className="text-left hover:underline" onClick={() => props.onOpenEntry(info.entry as string)}>
      {info.title}
    </button>
  ) : (
    info.title
  );
  return (
    <div className="my-2 animate-rise rounded-xl bg-stone-200/40 px-3 py-2 shadow-inset">
      <div className="flex items-center gap-2 text-xs text-stone-600">
        <CardIcon phase={info.phase} undone={undone} />
        <span className={`min-w-0 flex-1 ${undone ? "text-stone-400 line-through" : ""}`}>{title}</span>
        <UndoButton session={info.session} undone={undone} onUndone={() => setUndone(true)} onError={setFailure} />
      </div>
      <Chips info={info} undone={undone} onSelect={props.onSelect} />
      {[...info.notes, info.error ?? "", failure ?? ""].filter(Boolean).map((note) => (
        <p key={note} className="mt-1.5 text-xs text-stone-500">
          {note}
        </p>
      ))}
    </div>
  );
}
