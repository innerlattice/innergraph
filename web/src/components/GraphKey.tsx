// A small, collapsible key for the canvas: node types and edge looks from the graph design
// system, what the states look like, and the gestures.
import { Shapes } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { Schema } from "../api";
import { humanise } from "../../../src/core/edgeText";
import { edgeLook, nodeLookOf } from "../design/graph";
import { linkWord } from "./ItemMarks";
import { EdgeGlyph, LABEL_FONT, NodeGlyph } from "./GraphGlyph";
import { IconButton } from "./IconButton";
import { TipBody, Tooltip } from "./Tooltip";
import { useDismiss } from "../lib/useDismiss";

/** One row per relation, as the map draws it; a relation that can go either way (a causal one)
 *  has a row for each direction, named as chips name it ("increases", "decreases"). */
function relationsIn(schema: Schema | null) {
  return Object.entries(schema?.edgeTypes ?? {}).flatMap(([type, def]) => {
    const signs = (def.role ?? "plain") === "causal" ? [1, -1] : [undefined];
    return signs.map((sign) => {
      const look = edgeLook(schema, type, sign);
      const word = linkWord(schema, type, sign);
      const text = sign ? look.description : def.description;
      return { key: `${type}${sign ?? ""}`, look, word, tip: <TipBody title={sign ? `${humanise(word)} (${humanise(type)})` : humanise(type)} text={text} /> };
    });
  });
}

function Group(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-micro font-medium uppercase tracking-wide text-stone-400">{props.title}</h4>
      <ul className="space-y-1">{props.children}</ul>
    </section>
  );
}

/** Every row has the same height and a fixed-width cell for its sample, so the words line up.
 *  A row with a `tip` explains itself on hover. */
function Row(props: { mark: ReactNode; children: ReactNode; tip?: ReactNode }) {
  const body = (
    <span className="flex h-5 items-center gap-2">
      <span className="flex w-9 shrink-0 justify-center">{props.mark}</span>
      <span className="min-w-0 truncate">{props.children}</span>
    </span>
  );
  return <li>{props.tip ? <Tooltip content={props.tip}>{body}</Tooltip> : body}</li>;
}

/** Node types by their Schema group, in the order the Schema lists them; ungrouped ones last. */
function typeGroups(schema: Schema | null): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const [name, def] of Object.entries(schema?.nodeTypes ?? {})) {
    const group = def.display?.group ?? "";
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  const ungrouped = groups.get("");
  groups.delete("");
  const named = [...groups.entries()];
  if (!ungrouped) return named;
  return [...named, [named.length === 0 ? "Kinds of thing" : "Other kinds", ungrouped]];
}

const STATES = [
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400 shadow-halo" />, text: "Green halo: just changed" },
  { mark: <span className="h-3 w-3 rounded-full bg-stone-400/40 outline-1 outline-offset-2 outline-dashed outline-stone-400" />, text: "Faded, dashed ring: removed" },
];

const GESTURES = ["Drag across empty space to select", "Shift-click to add to the selection", "Scroll to pan, pinch to zoom", "Double-click a title to rename it"];

function KeyBody(props: { schema: Schema | null }) {
  return (
    <div className="max-h-popover space-y-3 overflow-y-auto px-3 pb-3 pt-1">
      {typeGroups(props.schema).map(([title, types]) => (
        <Group key={title} title={title}>
          {types.map((name) => {
            const look = nodeLookOf(props.schema, name);
            return (
              <Row key={name} mark={<NodeGlyph look={look} />} tip={<TipBody title={humanise(name)} text={props.schema?.nodeTypes[name].description} />}>
                <span className={LABEL_FONT[look.style]}>{humanise(name)}</span>
              </Row>
            );
          })}
        </Group>
      ))}
      <Group title="Links">
        {relationsIn(props.schema).map(({ key, look, word, tip }) => (
          <Row key={key} mark={<EdgeGlyph look={look} />} tip={tip}>
            {word}
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
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(panel, () => setOpen(false), open);
  return (
    <div ref={panel} className="absolute bottom-3 left-3 z-10 flex flex-col-reverse items-start gap-2">
      <IconButton label="Key" hint="What the shapes and lines mean" icon={Shapes} pressed={open} aria-expanded={open} onClick={() => setOpen(!open)} />
      {open ? (
        <div className="w-64 max-w-inset rounded-xl bg-white/90 pt-2 text-xs text-stone-600 shadow-floating backdrop-blur">
          <KeyBody schema={props.schema} />
        </div>
      ) : null}
    </div>
  );
}
