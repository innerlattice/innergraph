// A small, collapsible key for the canvas: node types and edge looks from the graph design
// system, what the states look like, and the gestures.
import { type ReactNode, useState } from "react";
import type { Schema } from "../api";
import { humanise } from "../../../src/core/edgeText";
import { EDGE_LOOKS, edgeLookOf, nodeLookOf } from "../design/graph";
import { EdgeGlyph, NodeGlyph } from "./GraphGlyph";

/** The edge looks this Schema can produce, in design-system order. */
function looksIn(schema: Schema | null) {
  const used = new Set(Object.values(schema?.edgeTypes ?? {}).flatMap((t) => [edgeLookOf(t.role ?? "plain", 1), edgeLookOf(t.role ?? "plain", -1)]));
  return EDGE_LOOKS.filter((look) => used.has(look.name));
}

function Group(props: { title: string; children: ReactNode; columns?: boolean }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{props.title}</h4>
      <ul className={props.columns ? "grid grid-cols-2 gap-x-4 gap-y-1.5" : "space-y-1.5"}>{props.children}</ul>
    </section>
  );
}

const Row = (props: { children: ReactNode }) => <li className="flex items-center gap-2">{props.children}</li>;

const STATES = [
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400 outline-[1.5px] outline-offset-2 outline-stone-400 outline" />, text: "Ringed: you confirmed it" },
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400 shadow-[0_0_0_4px_rgb(142_162_127/0.45)]" />, text: "Green halo: just changed" },
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400/40 outline-1 outline-offset-2 outline-dashed outline-stone-400" />, text: "Faded, dashed ring: removed" },
];

const GESTURES = ["Drag across empty space to select", "Shift-click to add to the selection", "Scroll to pan, pinch to zoom", "Double-click a title to rename it"];

function KeyBody(props: { schema: Schema | null }) {
  const types = Object.keys(props.schema?.nodeTypes ?? {});
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto px-3 pb-3 pt-1">
      <Group title="Kinds of thing" columns>
        {types.map((name) => (
          <Row key={name}>
            <NodeGlyph look={nodeLookOf(props.schema, name)} />
            {humanise(name)}
          </Row>
        ))}
      </Group>
      <Group title="Links">
        {looksIn(props.schema).map((look) => (
          <Row key={look.name}>
            <EdgeGlyph look={look} />
            {look.label}
            {look.mark ? <span className="font-bold" style={{ color: look.color }}>{look.mark}</span> : null}
          </Row>
        ))}
      </Group>
      <Group title="States">
        {STATES.map((s) => (
          <Row key={s.text}>
            <span className="flex w-9 justify-center">{s.mark}</span>
            {s.text}
          </Row>
        ))}
      </Group>
      <Group title="Moving around">
        {GESTURES.map((g) => (
          <li key={g} className="text-stone-500">{g}</li>
        ))}
      </Group>
    </div>
  );
}

export function GraphKey(props: { schema: Schema | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`absolute bottom-3 left-3 z-10 ${open ? "w-72" : ""} max-w-[calc(100%-1.5rem)] rounded-xl bg-white/90 text-xs text-stone-600 shadow-float backdrop-blur`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full rounded-xl px-3 py-2 text-left font-medium hover:text-stone-900">
        {open ? "Hide key" : "Key"}
      </button>
      {open ? <KeyBody schema={props.schema} /> : null}
    </div>
  );
}
