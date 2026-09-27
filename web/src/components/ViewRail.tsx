// The right rail: the views beside the conversation. Hover to see their names; click the open
// one again to close it and give the conversation the whole window.
import { BookOpen, History, Network, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { ICON } from "../design/tokens";

export type PaneName = "map" | "loops" | "entries" | "log";

const VIEWS: { view: PaneName; label: string; hint: string; icon: ReactNode }[] = [
  { view: "map", label: "Map", hint: "Your map, as it is now or was before", icon: <Network size={ICON.xl} /> },
  { view: "loops", label: "Loops", hint: "Patterns that keep themselves going", icon: <Repeat size={ICON.xl} /> },
  { view: "entries", label: "Entries", hint: "Your writing and what it supports", icon: <BookOpen size={ICON.xl} /> },
  { view: "log", label: "Log", hint: "Every change, with who made it", icon: <History size={ICON.xl} /> },
];

export function ViewRail(props: { active?: PaneName; onToggle: (view: PaneName) => void }) {
  return (
    <div className="relative w-view-rail shrink-0">
      <nav
        aria-label="Views"
        className="group/views absolute inset-y-0 right-0 z-40 flex w-view-rail flex-col gap-1 overflow-hidden bg-stone-100/95 px-1.5 py-4 backdrop-blur transition-[width,box-shadow] duration-200 hover:w-48 hover:shadow-lifted has-[:focus-visible]:w-48"
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
              className={`flex h-9 items-center gap-3 rounded-xl px-2.5 text-sm transition ${on ? "bg-white text-clay-600 shadow-raised" : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-900"}`}
            >
              <span className="shrink-0">{v.icon}</span>
              <span className="whitespace-nowrap opacity-0 transition-opacity group-hover/views:opacity-100 group-has-[:focus-visible]/views:opacity-100">{v.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
