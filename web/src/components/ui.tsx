import type { ButtonHTMLAttributes, ReactNode } from "react";

// Buttons: one shape, and tones that say how much an action matters.
//   primary: the one thing to do here (Save, Confirm)
//   quiet:   everything else
//   ghost:   backing out (Cancel), no border
//   danger:  not to be taken lightly
type Tone = "primary" | "quiet" | "ghost" | "danger";

const TONES: Record<Tone, string> = {
  primary: "bg-clay-500 text-white enabled:hover:bg-clay-600",
  quiet: "bg-white text-stone-700 shadow-raised enabled:hover:bg-clay-50 enabled:hover:shadow-floating",
  ghost: "text-stone-600 enabled:hover:bg-stone-200",
  danger: "bg-white text-rose-700 shadow-raised enabled:hover:bg-rose-50",
};

/** The classes of a Button, for links that act as one. */
export function buttonClass(tone: Tone = "quiet"): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]}`;
}

export function Button({ tone = "quiet", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" className={`${buttonClass(tone)} ${className}`} {...rest} />;
}

export function Page(props: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="@container mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl text-stone-800">{props.title}</h2>
          {props.subtitle ? <p className="mt-1 text-sm text-stone-500">{props.subtitle}</p> : null}
        </div>
        <div className="flex gap-2">{props.actions}</div>
      </header>
      {props.children}
    </div>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-white p-5 shadow-raised ${props.className ?? ""}`}>{props.children}</section>;
}

export function Empty(props: { children: ReactNode }) {
  return <p className="rounded-xl bg-stone-100/60 p-8 text-center text-sm text-stone-500">{props.children}</p>;
}

export function ErrorNote(props: { error?: string }) {
  if (!props.error) return null;
  return <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{props.error}</p>;
}

/** Only the exception is worth saying: removed. Confirmed is the expected case and shows nothing. */
export function StatusPill(props: { status: string }) {
  if (props.status === "removed") return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-400 line-through">removed</span>;
  return null;
}

export function Quote(props: { children: ReactNode; source?: string }) {
  return (
    <blockquote className="border-l-2 border-stone-300 pl-3 font-serif text-sm text-stone-700">
      “{props.children}”{props.source ? <span className="ml-2 font-sans text-xs text-stone-400">— {props.source}</span> : null}
    </blockquote>
  );
}
