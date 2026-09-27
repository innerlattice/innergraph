// Graph -> Cytoscape elements. How each node and edge looks comes from the graph design system
// (design/graph.ts), which reads the Schema's display hints. No type names are hard-coded here.
import type { ElementDefinition } from "cytoscape";
import { humanise } from "../../../src/core/edgeText";
import type { Schema, ViewEdge, ViewNode } from "../api";
import { edgeLookOf, nodeGem, nodeLookOf, nodeSize } from "../design/graph";

const MAX_LABEL = 60;

export function roleOf(schema: Schema | null, edgeType: string): string {
  return schema?.edgeTypes[edgeType]?.role ?? "plain";
}

export function clip(text: string, max = MAX_LABEL): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nodeElement(n: ViewNode, schema: Schema | null): ElementDefinition {
  const look = nodeLookOf(schema, n.type);
  const label = clip(n.label);
  const size = nodeSize(look, label);
  const image = nodeGem(look, size);
  return {
    data: { id: n.id, label, color: look.color, shape: look.shape, ...size, image: image.uri, imageW: image.width, imageH: image.height },
    classes: `${n.status} style-${look.style}`,
  };
}

export function edgeLabel(e: { type: string; sign?: number }, schema: Schema | null): string {
  if (roleOf(schema, e.type) === "causal") return e.sign === -1 ? "−" : "+";
  return humanise(e.type);
}

function edgeElement(e: ViewEdge, schema: Schema | null): ElementDefinition {
  return {
    data: { id: e.id, source: e.from, target: e.to, label: edgeLabel(e, schema) },
    classes: `look-${edgeLookOf(roleOf(schema, e.type), e.sign)} ${e.status}`,
  };
}

/** Everything the materialized View contains, and nothing else. */
export function toElements(view: { nodes: Record<string, ViewNode>; edges: Record<string, ViewEdge> }, schema: Schema | null): ElementDefinition[] {
  return [...Object.values(view.nodes).map((n) => nodeElement(n, schema)), ...Object.values(view.edges).map((e) => edgeElement(e, schema))];
}
