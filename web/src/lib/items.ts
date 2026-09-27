// Every item on the map, removed ones included, and the Schema that says how each kind looks,
// kept live and shared, so a chip anywhere shows an item's current name and kind without
// fetching it.
import { createContext, useContext } from "react";
import type { GraphView, Schema } from "../api";

export interface Items {
  view?: GraphView;
  schema: Schema | null;
}

const ItemsContext = createContext<Items>({ schema: null });

export const ItemsProvider = ItemsContext.Provider;

export function useItems(): Items {
  return useContext(ItemsContext);
}
