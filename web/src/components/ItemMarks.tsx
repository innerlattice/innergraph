// The marks that say what kind of thing an item is, each explaining itself on hover: a node
// type's gem and a link type's line, drawn from the graph design system as in the key.
import { humanise } from "../../../src/core/edgeText";
import type { Schema } from "../api";
import { type EdgeLook, edgeLook, nodeLookOf } from "../design/graph";
import { ICON, LINK_GLYPH } from "../design/tokens";
import { useItems } from "../lib/items";
import { EdgeGlyph, NodeGlyph } from "./GraphGlyph";
import { TipBody, Tooltip } from "./Tooltip";

/** A node type's gem; hovering it names the type and says what it is. */
export function TypeMark(props: { type: string; size?: number }) {
  const { schema } = useItems();
  return (
    <Tooltip content={<TipBody title={humanise(props.type)} text={schema?.nodeTypes[props.type]?.description} />}>
      <NodeGlyph look={nodeLookOf(schema, props.type)} size={props.size ?? ICON.xs} />
    </Tooltip>
  );
}

const isCausal = (look: EdgeLook) => look.name === "increases" || look.name === "decreases";

/** How a link reads in a phrase: a causal link by what it does ("increases"), any other by its type. */
export function linkWord(schema: Schema | null, type: string, sign?: number): string {
  const look = edgeLook(schema, type, sign);
  return isCausal(look) ? look.label.toLowerCase() : humanise(type);
}

/** A link type as the key draws it, its word then its line; hovering it says what the link means. */
export function LinkMark(props: { type: string; sign?: number }) {
  const { schema } = useItems();
  const look = edgeLook(schema, props.type, props.sign);
  const word = linkWord(schema, props.type, props.sign);
  const title = isCausal(look) ? `${look.label} (${humanise(props.type)})` : humanise(props.type);
  return (
    <Tooltip content={<TipBody title={title} text={schema?.edgeTypes[props.type]?.description} />}>
      <span className="inline-flex items-center gap-1" aria-label={word}>
        <span className="text-aside italic opacity-60" aria-hidden>
          {word}
        </span>
        <EdgeGlyph look={look} width={LINK_GLYPH.chip} />
      </span>
    </Tooltip>
  );
}
