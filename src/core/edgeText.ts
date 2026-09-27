// The one way an Edge is written as text ("The Hider —enacts→ Go quiet"), and how to read it
// back, so the server, agents and the UI agree. The UI renders the parts, not this string.
export interface EdgeParts {
  from: string;
  verb: string;
  to: string;
}

export function edgeText(from: string, type: string, to: string): string {
  return `${from} —${type}→ ${to}`;
}

const PATTERN = /^(.+?) —(.+?)→ (.+)$/s;

/** The parts of an Edge written by `edgeText`; undefined for anything else (a Node's label). */
export function parseEdgeText(text: string): EdgeParts | undefined {
  const match = PATTERN.exec(text);
  return match ? { from: match[1], verb: match[2].replace(/_/g, " "), to: match[3] } : undefined;
}
