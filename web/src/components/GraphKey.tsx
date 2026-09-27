// A small, collapsible key for the canvas: node types and edge looks from the graph design
// system, what the states look like, and the gestures.
import { type ReactNode, useState } from "react";
import type { Schema } from "../api";
import { humanise } from "../../../src/core/edgeText";
import { EDGE_LOOKS, edgeLookOf, nodeLookOf } from "../design/graph";
import { EdgeGlyph, LABEL_FONT, NodeGlyph } from "./GraphGlyph";

/** The edge looks this Schema can produce, in design-system order. */
function looksIn(schema: Schema | null) {
  const used = new Set(Object.values(schema?.edgeTypes ?? {}).flatMap((t) => [edgeLookOf(t.role ?? "plain", 1), edgeLookOf(t.role ?? "plain", -1)]));
  return EDGE_LOOKS.filter((look) => used.has(look.name));
}

function Group(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-micro font-medium uppercase tracking-wide text-stone-400">{props.title}</h4>
      <ul className="space-y-1">{props.children}</ul>
    </section>
  );
}

/** Every row has the same height and a fixed-width cell for its sample, so the words line up. */
function Row(props: { mark: ReactNode; children: ReactNode }) {
  return (
    <li className="flex h-5 items-center gap-2">
      <span className="flex w-9 shrink-0 justify-center">{props.mark}</span>
      <span className="min-w-0 truncate">{props.children}</span>
    </li>
  );
}

const STATES = [
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400 shadow-halo" />, text: "Green halo: just changed" },
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400/40 outline-1 outline-offset-2 outline-dashed outline-stone-400" />, text: "Faded, dashed ring: removed" },
];

const GESTURES = ["Drag across empty space to select", "Shift-click to add to the selection", "Scroll to pan, pinch to zoom", "Double-click a title to rename it"];

function KeyBody(props: { schema: Schema | null }) {
  const types = Object.keys(props.schema?.nodeTypes ?? {});
  return (
    <div className="max-h-popover space-y-3 overflow-y-auto px-3 pb-3 pt-1">
      <Group title="Kinds of thing">
        {types.map((name) => {
          const look = nodeLookOf(props.schema, name);
          return (
            <Row key={name} mark={<NodeGlyph look={look} />}>
              <span className={LABEL_FONT[look.style]}>{humanise(name)}</span>
            </Row>
          );
        })}
      </Group>
      <Group title="Links">
        {looksIn(props.schema).map((look) => (
          <Row key={look.name} mark={<EdgeGlyph look={look} />}>
            {look.label}
            {look.mark ? (
              <span className="ml-1 font-bold" style={{ color: look.color }}>
                {look.mark}
              </span>
            ) : null}
          </Row>
        ))}
      </Group>
      <Group title="States">
        {STATES.map((s) => (
          <Row key={s.text} mark={s.mark}>
            {s.text}
          </Row>
        ))}
      </Group>
      <Group title="Moving around">
        {GESTURES.map((g) => (
          <li key={g} className="leading-5 text-stone-500">
            {g}
          </li>
        ))}
      </Group>
    </div>
  );
}

export function GraphKey(props: { schema: Schema | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`absolute bottom-3 left-3 z-10 ${open ? "w-64" : ""} max-w-inset rounded-xl bg-white/90 text-xs text-stone-600 shadow-floating backdrop-blur`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full rounded-xl px-3 py-2 text-left font-medium hover:text-stone-900">
        {open ? "Hide key" : "Key"}
      </button>
      {open ? <KeyBody schema={props.schema} /> : null}
    </div>
  );
}
