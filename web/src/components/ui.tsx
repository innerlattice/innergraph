import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "primary" | "quiet" | "danger";

const TONES: Record<Tone, string> = {
  primary: "bg-stone-800 text-stone-50 hover:bg-stone-700",
  quiet: "border border-stone-300 bg-white text-stone-700 hover:bg-stone-100",
  danger: "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
};

export function Button({ tone = "quiet", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]} ${className}`}
      {...rest}
    />
  );
}

export function Page(props: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
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
  return <section className={`rounded-xl border border-stone-200 bg-white p-5 shadow-sm ${props.className ?? ""}`}>{props.children}</section>;
}

export function Empty(props: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{props.children}</p>;
}

export function ErrorNote(props: { error?: string }) {
  if (!props.error) return null;
  return <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{props.error}</p>;
}

/** Only what is worth saying: confirmed, or removed. Unconfirmed is the quiet default. */
export function StatusPill(props: { status: string; confirmed?: boolean }) {
  if (props.status === "removed") return <span className="rounded-full border border-stone-200 px-2 py-0.5 text-xs text-stone-400 line-through">removed</span>;
  if (props.confirmed) return <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">confirmed</span>;
  return null;
}

export function Quote(props: { children: ReactNode; source?: string }) {
  return (
    <blockquote className="border-l-2 border-stone-300 pl-3 font-serif text-sm text-stone-700">
      “{props.children}”{props.source ? <span className="ml-2 font-sans text-xs text-stone-400">— {props.source}</span> : null}
    </blockquote>
  );
}
