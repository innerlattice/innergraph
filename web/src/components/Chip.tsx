// Chip: a compact, rounded token for one thing on the map (a Node, an Edge) or one piece of
// context. Tones carry meaning, not decoration:
//   neutral  — an item you can open (tool cards, an entry's items)
//   context  — something the assistant is being told about (the selection)
//   accent   — the one primary action in a row of chips ("Show all")
// A chip is a button when it does something, and gains a remove control with `onRemove`.
// Labels go through ItemLabel, so Edges read as "from  link  to" everywhere.
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { parseEdgeText } from "../../../src/core/edgeText";
import { ICON } from "../design/tokens";
import { LinkMark } from "./ItemMarks";

type ChipTone = "neutral" | "context" | "accent";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-stone-100 text-stone-700 enabled:hover:bg-clay-50",
  context: "bg-sage-50 text-sage-700 enabled:hover:bg-sage-100",
  accent: "bg-clay-500 text-white enabled:hover:bg-clay-600",
};

/** A chip answering to something under the pointer: lifted and warmed. */
const LIT = "bg-clay-100 text-stone-800 shadow-floating";

const BASE = "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full text-xs leading-5 transition disabled:opacity-60";

export interface ChipProps {
  children: ReactNode;
  /** A mark before the words, such as a node's gem; it stays put when the words truncate. */
  lead?: ReactNode;
  tone?: ChipTone;
  onClick?: () => void;
  /** Adds a remove control; `removeLabel` names it for screen readers. */
  onRemove?: () => void;
  removeLabel?: string;
  /** No longer applies (e.g. undone): struck through and inert. */
  struck?: boolean;
  /** Answers to something under the pointer elsewhere, such as the passage that cites it. */
  lit?: boolean;
  title?: string;
}

export function Chip(props: ChipProps) {
  const { tone = "neutral" } = props;
  const body = (
    <button
      type="button"
      title={props.title}
      disabled={props.struck || !props.onClick}
      onClick={props.onClick}
      className={`inline-flex min-w-0 items-center gap-1 text-left ${props.struck ? "line-through" : ""}`}
    >
      {props.lead}
      <span className="min-w-0 truncate">{props.children}</span>
    </button>
  );
  if (!props.onRemove) {
    return (
      <span className={`${BASE} ${props.lit ? LIT : TONES[tone]} px-2.5 ${props.struck ? "opacity-60" : ""}`} data-tone={tone} data-lit={props.lit || undefined}>
        {body}
      </span>
    );
  }
  return (
    <span className={`${BASE} ${TONES[tone]} py-0 pr-1 pl-2.5`} data-tone={tone}>
      {body}
      <button
        type="button"
        aria-label={props.removeLabel ?? "Remove"}
        onClick={props.onRemove}
        className="shrink-0 rounded-full p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100"
      >
        <X size={ICON.xs} />
      </button>
    </span>
  );
}

/** An Edge as a phrase: the two things it joins carry the weight; the link type, drawn as in the
 *  key, sits quietly between. Either end may be left out when the context already names it (a
 *  Node's own panel). */
export function EdgeLabel(props: { from?: string; type: string; sign?: number; to?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {props.from ? <span className="min-w-0 truncate">{props.from}</span> : null}
      <LinkMark type={props.type} sign={props.sign} />
      {props.to ? <span className="min-w-0 truncate">{props.to}</span> : null}
    </span>
  );
}

/** Any item's label: an Edge (written as "from —type→ to") renders as EdgeLabel, anything else as is. */
export function ItemLabel(props: { label: string }) {
  const edge = parseEdgeText(props.label);
  return edge ? <EdgeLabel {...edge} /> : props.label;
}
