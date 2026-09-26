// A small, collapsible key for the canvas: node types (from the Schema) and edge styles.
import { useState } from "react";
import type { Schema } from "../api";
import { humanise } from "../lib/elements";
import { colorFor } from "../lib/format";

const SHAPE_CLASS: Record<string, string> = {
  ellipse: "rounded-full",
  "round-rectangle": "rounded-sm w-5",
  "round-diamond": "rotate-45 rounded-[2px] scale-75",
};

export function GraphKey(props: { schema: Schema | null }) {
  const [open, setOpen] = useState(false);
  const types = Object.entries(props.schema?.nodeTypes ?? {});
  return (
    <div className="absolute bottom-3 left-3 z-10 max-w-sm rounded-lg border border-stone-200 bg-white/95 text-xs text-stone-600 shadow-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full px-3 py-1.5 text-left font-medium hover:bg-stone-50">
        {open ? "Hide key" : "Key"}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-stone-100 px-3 py-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {types.map(([name, def]) => (
              <span key={name} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 ${SHAPE_CLASS[def.display?.shape ?? "ellipse"] ?? "rounded"}`} style={{ backgroundColor: def.display?.color ?? colorFor(name, props.schema) }} />
                {humanise(name)}
              </span>
            ))}
          </div>
          <p className="text-stone-500">
            <span className="font-bold text-orange-700">+</span> increases · <span className="font-bold text-sky-700">−</span> decreases · thick line = derivation · firmer outline = confirmed · green halo = just changed
          </p>
          <p className="text-stone-400">Drag to select · shift-click to add · scroll to pan · pinch to zoom · double-click a title to rename</p>
        </div>
      ) : null}
    </div>
  );
}
