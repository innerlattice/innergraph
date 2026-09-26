// The right rail: the views beside the conversation. Hover to see their names; click the open
// one again to close it and give the conversation the whole window.
import { BookOpen, History, Network, Repeat } from "lucide-react";
import type { ReactNode } from "react";

export type PaneName = "map" | "loops" | "entries" | "log";

const VIEWS: { view: PaneName; label: string; hint: string; icon: ReactNode }[] = [
  { view: "map", label: "Map", hint: "Your graph, now or at any time", icon: <Network size={18} /> },
  { view: "loops", label: "Loops", hint: "Cycles that keep themselves going", icon: <Repeat size={18} /> },
  { view: "entries", label: "Entries", hint: "Your writing and what it supports", icon: <BookOpen size={18} /> },
  { view: "log", label: "Log", hint: "Every change, with who made it", icon: <History size={18} /> },
];

export function ViewRail(props: { active?: PaneName; onToggle: (view: PaneName) => void }) {
  return (
    <div className="relative w-12 shrink-0">
      <nav
        aria-label="Views"
        className="group/views absolute inset-y-0 right-0 z-40 flex w-12 flex-col gap-1 overflow-hidden border-l border-stone-200/70 bg-stone-100/95 px-1.5 py-4 backdrop-blur transition-[width,box-shadow] duration-200 hover:w-48 hover:shadow-2xl focus-within:w-48"
      >
        {VIEWS.map((v) => {
          const on = props.active === v.view;
          return (
            <button
              key={v.view}
              type="button"
              title={v.hint}
              aria-pressed={on}
              onClick={() => props.onToggle(v.view)}
              className={`flex h-9 items-center gap-3 rounded-xl px-2.5 text-sm transition ${on ? "bg-white text-clay-600 shadow-sm" : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-900"}`}
            >
              <span className="shrink-0">{v.icon}</span>
              <span className="whitespace-nowrap opacity-0 transition-opacity group-hover/views:opacity-100 group-focus-within/views:opacity-100">{v.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
