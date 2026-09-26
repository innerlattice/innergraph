// Stable node positions. Nodes keep their position across re-renders, time travel and
// reloads; only nodes never seen before are laid out. Per-viewer convenience only.

export interface Point {
  x: number;
  y: number;
}

export type Positions = Map<string, Point>;

const KEY = "inner-graph:positions";

export function loadPositions(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Positions {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "{}") as Record<string, Point>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

export function savePositions(positions: Positions, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // Storage may be unavailable (private mode); positions then last for this session only.
  }
}

/** Splits node ids into those with a remembered position and those needing layout. */
export function partition(ids: string[], positions: Positions): { known: string[]; unknown: string[] } {
  return { known: ids.filter((id) => positions.has(id)), unknown: ids.filter((id) => !positions.has(id)) };
}

/** Ids present now that were absent in the previous render. Nothing counts as new on the first non-empty render. */
export function appeared(previous: Set<string> | undefined, current: string[]): string[] {
  if (!previous || previous.size === 0) return [];
  return current.filter((id) => !previous.has(id));
}
