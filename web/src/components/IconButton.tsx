// A round button that shows only its icon and names itself on hover, as a tooltip. Every
// icon-only action in the app uses it, so they all rise and explain themselves the same way.
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { ICON } from "../design/tokens";
import { TipBody, Tooltip } from "./Tooltip";

// quiet and primary rest raised on the page and rise to meet the pointer. well sits flat and small
// inside something already set into the page, like a card in the conversation, and rises out of
// it only on hover.
type Tone = "quiet" | "primary" | "well";

const TONES: Record<Tone, string> = {
  quiet: "h-8 w-8 bg-white text-stone-600 shadow-raised enabled:hover:bg-clay-50 enabled:hover:text-stone-900 enabled:hover:shadow-floating",
  primary: "h-8 w-8 bg-clay-500 text-white shadow-raised enabled:hover:bg-clay-600 enabled:hover:shadow-floating",
  well: "h-6 w-6 text-stone-500 enabled:hover:bg-white enabled:hover:text-stone-800 enabled:hover:shadow-raised",
};

/** Pressed in, like a toggle that is on. */
const PRESSED = "h-8 w-8 bg-stone-200/60 text-stone-800 shadow-inset";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Its name: read by screen readers and shown on hover. */
  label: string;
  icon: LucideIcon;
  /** A line under the name in the tooltip, when the name alone isn't enough. */
  hint?: string;
  tone?: Tone;
  pressed?: boolean;
  /** A small count on its shoulder, like the duplicates waiting in History. */
  badge?: number;
}

export function IconButton(props: IconButtonProps) {
  const { label, icon: Icon, hint, tone = "quiet", pressed, badge, className = "", ...rest } = props;
  return (
    <Tooltip content={<TipBody title={label} text={hint} />}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={`relative inline-flex shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${pressed ? PRESSED : TONES[tone]} ${className}`}
        {...rest}
      >
        <Icon size={tone === "well" ? ICON.sm : ICON.lg} aria-hidden="true" />
        {badge ? <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-clay-100 px-1 text-micro leading-4 text-clay-700">{badge}</span> : null}
      </button>
    </Tooltip>
  );
}
