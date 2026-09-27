// One Node or Edge, wherever it appears: a chip with the node's gem and its current name, or an
// Edge as "from  link  to". Names come from the live map, so a rename shows everywhere at once;
// `label` is only the fallback for items the map no longer has.
import { useItems } from "../lib/items";
import { Chip, type ChipProps, EdgeLabel, ItemLabel } from "./Chip";
import { TypeMark, linkWord } from "./ItemMarks";

export interface ItemChipProps extends Omit<ChipProps, "children" | "lead"> {
  id: string;
  label?: string;
}

function useItemFace(id: string, label: string | undefined) {
  const { view, schema } = useItems();
  const node = view?.nodes[id];
  if (node) return { lead: <TypeMark type={node.type} />, text: node.label, body: <>{node.label}</> };
  const edge = view?.edges[id];
  const name = (n: string) => view?.nodes[n]?.label ?? n;
  if (edge)
    return {
      text: `${name(edge.from)} ${linkWord(schema, edge.type, edge.sign)} ${name(edge.to)}`,
      body: <EdgeLabel from={name(edge.from)} type={edge.type} sign={edge.sign} to={name(edge.to)} />,
    };
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
