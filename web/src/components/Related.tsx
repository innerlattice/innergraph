// Earlier material that may be related to something on the map, shown as soon as it's asked for.
import type { RelatedItem } from "../api";

export function Related(props: { items: RelatedItem[] }) {
  if (props.items.length === 0) return <p className="text-sm text-stone-400">Nothing from before looks related.</p>;
  return (
    <ul className="space-y-3">
      {props.items.map((item) => (
        <li key={item.id} className="text-sm">
          <p className="font-medium text-stone-700">{item.title}</p>
          <p className="text-stone-500">{item.snippet}</p>
        </li>
      ))}
    </ul>
  );
}
