// One Node or Edge, wherever it appears: a chip with the node's gem and its current name, or an
// Edge as "from  verb →  to". Names come from the live map, so a rename shows everywhere at once;
// `label` is only the fallback for items the map no longer has.
import { humanise } from "../../../src/core/edgeText";
import { nodeLookOf } from "../design/graph";
import { useItems } from "../lib/items";
import { Chip, type ChipProps, EdgeLabel, ItemLabel } from "./Chip";
import { NodeGlyph } from "./GraphGlyph";
import { ICON } from "../design/tokens";

export interface ItemChipProps extends Omit<ChipProps, "children" | "lead"> {
  id: string;
  label?: string;
}

function useItemFace(id: string, label: string | undefined) {
  const { view, schema } = useItems();
  const node = view?.nodes[id];
  if (node) return { lead: <NodeGlyph look={nodeLookOf(schema, node.type)} size={ICON.xs} />, text: node.label, body: <>{node.label}</> };
  const edge = view?.edges[id];
  const name = (n: string) => view?.nodes[n]?.label ?? n;
  if (edge) return { text: `${name(edge.from)} ${humanise(edge.type)} ${name(edge.to)}`, body: <EdgeLabel from={name(edge.from)} verb={humanise(edge.type)} to={name(edge.to)} /> };
  return { text: label ?? id, body: <ItemLabel label={label ?? id} /> };
}

export function ItemChip(props: ItemChipProps) {
  const { id, label, ...chip } = props;
  const face = useItemFace(id, label);
  return (
    <Chip title={face.text} {...chip} lead={face.lead} removeLabel={chip.removeLabel ?? `Unselect ${face.text}`}>
      {face.body}
    </Chip>
  );
}
