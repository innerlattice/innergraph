// Earlier material that may be related, folded away until asked for.
import { useState } from "react";
import type { RelatedItem } from "../api";
import { Card } from "./ui";

export function Related(props: { items: RelatedItem[] }) {
  const [open, setOpen] = useState(false);
  if (props.items.length === 0) return null;
  return (
    <Card className="bg-stone-50">
      <button type="button" className="text-sm text-stone-600 underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Hide related material" : `Something from before may be related (${props.items.length}). Show?`}
      </button>
      {open ? (
        <ul className="mt-3 space-y-3">
          {props.items.map((item) => (
            <li key={item.id} className="text-sm">
              <p className="font-medium text-stone-700">{item.title}</p>
              <p className="text-stone-500">{item.snippet}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
