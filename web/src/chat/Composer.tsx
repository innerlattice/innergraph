// Where the person writes: what they have selected on the map (so "these" means something),
// how full the conversation is, and the box itself.
import { ArrowUp, Square } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { WARN_AT } from "../../../src/core/budget";
import type { BudgetLevel, SelectionItem } from "../api";
import { Chip, ItemLabel } from "../components/Chip";
import { Button } from "../components/ui";

/** Beyond this many, the chips fold into "+N more". */
const SHOWN = 4;

export function SelectionChips(props: { items: SelectionItem[]; onRemove: (id: string) => void; onSelect: (ids: string[]) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (props.items.length === 0) return null;
  const hidden = open ? 0 : Math.max(props.items.length - SHOWN, 0);
  return (
    <div className="mb-2 flex max-h-40 flex-wrap items-center gap-1.5 overflow-y-auto px-1 text-xs">
      <span className="text-stone-400">About</span>
      {props.items.slice(0, props.items.length - hidden).map((item) => (
        <Chip key={item.id} tone="context" onClick={() => props.onSelect([item.id])} onRemove={() => props.onRemove(item.id)} removeLabel={`Unselect ${item.label}`}>
          <ItemLabel label={item.label} />
        </Chip>
      ))}
      {hidden > 0 ? (
        <button type="button" className="rounded-full px-1.5 text-sage-700 hover:underline" onClick={() => setOpen(true)}>
          +{hidden} more
        </button>
      ) : null}
      {props.items.length > 1 ? (
        <button type="button" className="text-stone-400 hover:text-stone-700" onClick={props.onClear}>
          clear
        </button>
      ) : null}
    </div>
  );
}

export function BudgetNotice(props: { level: BudgetLevel; share: number }) {
  if (props.level !== "warn") return null;
  return (
    <p className="mb-2 rounded-xl bg-clay-50 px-3.5 py-2 text-xs leading-relaxed text-clay-700">
      This conversation is getting long ({Math.round(props.share * 100)}% of its room). It will end soon; a fresh one keeps things clear, and nothing on your map is lost.
    </p>
  );
}

export function FullNotice(props: { onNewChat: () => void }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white/80 px-5 py-4 text-center">
      <p className="font-serif text-stone-700">This conversation is full.</p>
      <p className="mt-1 text-sm text-stone-500">Everything it added to your map stays. Start a new one to keep going.</p>
      <Button tone="primary" onClick={props.onNewChat} className="mt-3">
        Start a new conversation
      </Button>
    </div>
  );
}

/** A small ring showing how much of the conversation's room is used. */
export function ContextMeter(props: { share: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const tone = props.share >= WARN_AT ? "stroke-clay-500" : "stroke-stone-400";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label={`${Math.round(props.share * 100)}% of this conversation's room used`}>
      <title>{`${Math.round(props.share * 100)}% of this conversation's room used`}</title>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-stone-200" />
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className={tone} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(props.share, 1))} transform="rotate(-90 9 9)" strokeLinecap="round" />
    </svg>
  );
}

export interface ComposerProps {
  busy: boolean;
  draft?: string;
  footer: string;
  share: number;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer(props: ComposerProps) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.draft === undefined) return;
    setText(props.draft);
    box.current?.focus();
  }, [props.draft]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);
  const send = () => {
    if (!text.trim() || props.busy) return;
    props.onSend(text);
    setText("");
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div>
      <div className="flex items-end gap-2 rounded-3xl border border-stone-200 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(60,40,20,0.06)] transition focus-within:border-clay-200">
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write what's on your mind…"
          aria-label="Message"
          className="max-h-80 min-h-7 flex-1 resize-none bg-transparent font-serif text-[15px] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400"
        />
        {props.busy ? (
          <button type="button" aria-label="Stop" onClick={props.onStop} className="rounded-full bg-stone-200 p-2 text-stone-600 transition hover:bg-stone-300">
            <Square size={14} />
          </button>
        ) : (
          <button type="button" aria-label="Send" disabled={!text.trim()} onClick={send} className="rounded-full bg-clay-500 p-2 text-white transition hover:bg-clay-600 disabled:bg-stone-200 disabled:text-stone-400">
            <ArrowUp size={16} />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between px-3 text-[11px] text-stone-400">
        <span>{props.footer}</span>
        <ContextMeter share={props.share} />
      </div>
    </div>
  );
}
