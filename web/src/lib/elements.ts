// Graph -> Cytoscape elements, styled by Role and Status (never by type name).
import type { ElementDefinition, StylesheetJson } from "cytoscape";
import type { Graph, Schema } from "../api";
import { colorFor } from "./format";

export function roleOf(schema: Schema | null, edgeType: string): string {
  return schema?.edgeTypes[edgeType]?.role ?? "plain";
}

function signClass(sign: number | undefined): string {
  if (sign === -1) return "negative";
  return sign === 1 ? "positive" : "";
}

export function toElements(graph: Graph, schema: Schema | null): ElementDefinition[] {
  const nodes = Object.values(graph.nodes).map((n) => ({
    data: { id: n.id, label: n.label, color: colorFor(n.type, schema) },
    classes: n.status,
  }));
  const edges = Object.values(graph.edges).map((e) => ({
    data: { id: e.id, source: e.from, target: e.to, label: e.type },
    classes: [roleOf(schema, e.type), signClass(e.sign), e.status].join(" "),
  }));
  return [...nodes, ...edges];
}

export const GRAPH_STYLE: StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      label: "data(label)",
      "font-size": 11,
      color: "#44403c",
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "text-valign": "bottom",
      "text-margin-y": 6,
      width: 26,
      height: 26,
      "border-width": 2,
      "border-color": "#fafaf9",
    },
  },
  { selector: "node.hypothesis", style: { "border-style": "dashed", "border-color": "#78716c" } },
  { selector: "node.parked", style: { opacity: 0.35 } },
  { selector: "node.superseded", style: { opacity: 0.2 } },
  { selector: "node:selected", style: { "border-color": "#1c1917", "border-width": 3 } },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#a8a29e",
      "target-arrow-color": "#a8a29e",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": 9,
      color: "#78716c",
      "text-rotation": "autorotate",
    },
  },
  { selector: "edge.hypothesis", style: { "line-style": "dashed" } },
  { selector: "edge.derivational", style: { width: 2.5, "line-color": "#57534e", "target-arrow-color": "#57534e" } },
  { selector: "edge.causal.positive", style: { "line-color": "#c2410c", "target-arrow-color": "#c2410c" } },
  { selector: "edge.causal.negative", style: { "line-color": "#0369a1", "target-arrow-color": "#0369a1" } },
  { selector: "edge.identity", style: { "line-style": "dotted", "target-arrow-shape": "none" } },
  { selector: ".highlight", style: { "border-color": "#ca8a04", "border-width": 4, "border-style": "solid", "line-style": "solid", "line-color": "#ca8a04", "target-arrow-color": "#ca8a04", width: 4 } },
];
