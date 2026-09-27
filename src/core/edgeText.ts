// The one way an Edge is written as text ("The Hider —enacts→ Go quiet"), and how to read it
// back, so the server, agents and the UI agree. The UI renders the parts, not this string.
export interface EdgeParts {
  from: string;
  /** The Edge's schema type, e.g. "part_of". */
  type: string;
  to: string;
}

/** A schema type as words: "part_of" → "part of". */
export function humanise(type: string): string {
  return type.replace(/_/g, " ");
}

export function edgeText(from: string, type: string, to: string): string {
  return `${from} —${type}→ ${to}`;
}

/** An Edge written with its Nodes' labels from `graph` (their ids when a Node isn't there). */
export function edgeTextIn(graph: { nodes: Record<string, { label: string } | undefined> }, edge: { from: string; type: string; to: string }): string {
  const name = (id: string) => graph.nodes[id]?.label ?? id;
  return edgeText(name(edge.from), edge.type, name(edge.to));
}

const PATTERN = /^(.+?) —(.+?)→ (.+)$/s;

/** The parts of an Edge written by `edgeText`; undefined for anything else (a Node's label). */
export function parseEdgeText(text: string): EdgeParts | undefined {
  const match = PATTERN.exec(text);
  return match ? { from: match[1], type: match[2], to: match[3] } : undefined;
}
