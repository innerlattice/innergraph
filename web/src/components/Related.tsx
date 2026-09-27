// Earlier material that may be related to something on the map, shown as soon as it's asked for.
// Nodes are chips like everywhere else; an entry is a chip to open it, with the words that matched.
import { BookOpen } from "lucide-react";
import type { RelatedItem } from "../api";
import { Chip } from "./Chip";
import { ItemChip } from "./ItemChip";

export function Related(props: { items: RelatedItem[]; onSelect: (id: string) => void; onOpenEntry: (id: string) => void }) {
  if (props.items.length === 0) return <p className="text-sm text-stone-400">Nothing from before looks related.</p>;
  return (
    <ul className="space-y-2">
      {props.items.map((item) => (
        <li key={item.id} className="space-y-1">
          {item.kind === "entry" ? (
            <>
              <Chip lead={<BookOpen size={11} aria-hidden />} onClick={() => props.onOpenEntry(item.id)}>
                {item.title}
              </Chip>
              <p className="line-clamp-2 pl-2.5 font-serif text-sm text-stone-500">{item.snippet}</p>
            </>
          ) : (
            <ItemChip id={item.id} label={item.title} onClick={() => props.onSelect(item.id)} />
          )}
        </li>
      ))}
    </ul>
  );
}
