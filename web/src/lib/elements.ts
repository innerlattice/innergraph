// Graph -> Cytoscape elements. Shape, colour and label style come from the Schema's display
// hints; edges are styled by Role and sign. No type names are hard-coded here.
import type { ElementDefinition, StylesheetJson } from "cytoscape";
import type { LabelStyle } from "../../../src/core/types";
import type { Graph, GraphEdge, GraphNode, PendingItem, Schema } from "../api";
import { colorFor } from "./format";

const MAX_LABEL = 60;
const CHAR_WIDTH = 6.4;
const BOX_TEXT_WIDTH = 150;

export function roleOf(schema: Schema | null, edgeType: string): string {
  return schema?.edgeTypes[edgeType]?.role ?? "plain";
}

export function labelStyleOf(schema: Schema | null, nodeType: string): LabelStyle {
  return schema?.nodeTypes[nodeType]?.label ?? "name";
}

export function humanise(type: string): string {
  return type.replace(/_/g, " ");
}

export function clip(text: string, max = MAX_LABEL): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function signClass(sign: number | undefined): string {
  if (sign === -1) return "negative";
  return sign === 1 ? "positive" : "";
}

/** Statement nodes are boxes sized to hold their wrapped text. */
export function boxSize(label: string): { w: number; h: number } {
  const textWidth = label.length * CHAR_WIDTH;
  const lines = Math.max(1, Math.ceil(textWidth / BOX_TEXT_WIDTH));
  return { w: Math.min(BOX_TEXT_WIDTH, textWidth) + 22, h: lines * 15 + 18 };
}

function nodeElement(n: GraphNode, schema: Schema | null): ElementDefinition {
  const def = schema?.nodeTypes[n.type];
  const style = labelStyleOf(schema, n.type);
  const label = clip(n.label);
  return {
    data: { id: n.id, label, color: def?.display?.color ?? colorFor(n.type, schema), shape: def?.display?.shape ?? "ellipse", ...boxSize(label) },
    classes: `${n.status} style-${style}`,
  };
}

export function edgeLabel(e: GraphEdge, schema: Schema | null): string {
  if (roleOf(schema, e.type) === "causal") return e.sign === -1 ? "−" : "+";
  return humanise(e.type);
}

function edgeElement(e: GraphEdge, schema: Schema | null): ElementDefinition {
  return {
    data: { id: e.id, source: e.from, target: e.to, label: edgeLabel(e, schema) },
    classes: [roleOf(schema, e.type), signClass(e.sign), e.status].join(" "),
  };
}

function asProposed(el: ElementDefinition): ElementDefinition {
  return { ...el, classes: `${el.classes} proposed` };
}

/** Graph elements plus proposed (unreviewed) Nodes/Edges drawn as ghosts. */
export function toElements(graph: Graph, schema: Schema | null, proposed: PendingItem[] = []): ElementDefinition[] {
  const nodes = proposed.flatMap((p) => (p.kind === "node" ? [asProposed(nodeElement(p.item as GraphNode, schema))] : []));
  const edges = proposed.flatMap((p) => (p.kind === "edge" ? [asProposed(edgeElement(p.item as GraphEdge, schema))] : []));
  return [
    ...Object.values(graph.nodes).map((n) => nodeElement(n, schema)),
    ...nodes,
    ...Object.values(graph.edges).map((e) => edgeElement(e, schema)),
    ...edges,
  ];
}

export const GRAPH_STYLE: StylesheetJson = [
  {
    selector: "node",
    style: {
      shape: "data(shape)" as never,
      "background-color": "data(color)",
      "border-color": "data(color)",
      "border-width": 2,
      label: "data(label)",
      "font-size": 11,
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      color: "#292524",
      "text-wrap": "wrap",
      "text-max-width": "110px",
      "text-valign": "bottom",
      "text-margin-y": 5,
      width: 26,
      height: 26,
    },
  },
  { selector: "node.style-name", style: { "font-weight": 600 } },
  { selector: "node.style-title", style: { "font-style": "italic", width: 22, height: 22 } },
  {
    selector: "node.style-statement",
    style: {
      width: "data(w)",
      height: "data(h)",
      "background-opacity": 0.14,
      "text-valign": "center",
      "text-margin-y": 0,
      "text-max-width": `${BOX_TEXT_WIDTH}px`,
      "font-family": "ui-serif, Georgia, serif",
      "font-size": 11.5,
    },
  },
  // Hypotheses read as lighter; only statement boxes get a dashed outline (dashes look ragged on small shapes).
  { selector: "node.hypothesis", style: { "background-opacity": 0.55, "border-opacity": 0.6 } },
  { selector: "node.hypothesis.style-statement", style: { "background-opacity": 0.1, "border-style": "dashed", "border-opacity": 1 } },
  { selector: "node.accepted", style: { "border-style": "solid", "border-width": 2.5 } },
  { selector: "node.parked", style: { opacity: 0.3 } },
  { selector: "node.superseded", style: { opacity: 0.15 } },
  { selector: "node:selected", style: { "overlay-color": "#1c1917", "overlay-opacity": 0.08, "overlay-padding": 6 } },
  {
    selector: "edge",
    style: {
      width: 1.4,
      "line-color": "#a8a29e",
      "target-arrow-color": "#a8a29e",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": 9,
      color: "#78716c",
      "text-background-color": "#fafaf9",
      "text-background-opacity": 1,
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
  { selector: "edge.hypothesis", style: { "line-style": "dashed" } },
  { selector: "edge.superseded", style: { opacity: 0.25, "line-style": "dotted" } },
  { selector: "edge.derivational", style: { width: 2.6, "line-color": "#57534e", "target-arrow-color": "#57534e" } },
  { selector: "edge.causal", style: { width: 2, "font-size": 13, "font-weight": 700 } },
  { selector: "edge.causal.positive", style: { "line-color": "#c2410c", "target-arrow-color": "#c2410c", color: "#c2410c" } },
  { selector: "edge.causal.negative", style: { "line-color": "#0369a1", "target-arrow-color": "#0369a1", color: "#0369a1" } },
  { selector: "edge.identity", style: { "line-style": "dotted", "target-arrow-shape": "none" } },
  { selector: "node.proposed", style: { "background-opacity": 0.2, "border-color": "#d97706", "border-style": "dashed", "border-width": 2.5, "border-opacity": 1 } },
  { selector: "edge.proposed", style: { "line-color": "#d97706", "target-arrow-color": "#d97706", "line-style": "dashed", width: 2 } },
  { selector: "node.appeared", style: { "underlay-color": "#16a34a", "underlay-opacity": 0.25, "underlay-padding": 7 } },
  { selector: "node.highlight", style: { "border-color": "#ca8a04", "border-width": 4, "border-style": "solid" } },
  { selector: "edge.highlight", style: { "line-color": "#ca8a04", "target-arrow-color": "#ca8a04", width: 3.5 } },
];
