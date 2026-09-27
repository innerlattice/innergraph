// The graph's design-system components: how a node type and an edge look. The Cytoscape
// stylesheet, the canvas elements and the glyphs in the key and panels all read from here, so
// restyling the graph means editing this folder. See docs/DESIGN.md.
import type { StylesheetJson } from "cytoscape";
import type { LabelStyle } from "../../../src/core/types";
import type { Schema } from "../api";
import { colorFor } from "../lib/format";
import { type Gem, gem } from "./gem";

const PAPER = "#f8f4ee";
const INK = "#3b332b";
const MUTED = "#867867";
const HIGHLIGHT = "#d4a017";

// ---- Nodes ----

const NAME_SIZE = 28;
const TITLE_SIZE = 24;
const CHAR_WIDTH = 6.4;
const BOX_TEXT_WIDTH = 150;

export interface NodeLook {
  shape: string;
  color: string;
  style: LabelStyle;
}

export function labelStyleOf(schema: Schema | null, nodeType: string): LabelStyle {
  return schema?.nodeTypes[nodeType]?.label ?? "name";
}

/** A node type's shape, colour and label style, from the Schema's display hints. */
export function nodeLookOf(schema: Schema | null, nodeType: string): NodeLook {
  const display = schema?.nodeTypes[nodeType]?.display;
  return { shape: display?.shape ?? "ellipse", color: display?.color ?? colorFor(nodeType, schema), style: labelStyleOf(schema, nodeType) };
}

/** Statement nodes are boxes sized to hold their wrapped text. */
export function boxSize(label: string): { w: number; h: number } {
  const textWidth = label.length * CHAR_WIDTH;
  const lines = Math.max(1, Math.ceil(textWidth / BOX_TEXT_WIDTH));
  return { w: Math.min(BOX_TEXT_WIDTH, textWidth) + 22, h: lines * 15 + 18 };
}

/** Slanted and pointed shapes narrow towards their edges, so a text box inside them needs more width. */
const BOX_SHAPES = new Set(["round-rectangle", "barrel", "ellipse"]);

export function nodeSize(look: NodeLook, label: string): { w: number; h: number } {
  if (look.style === "statement") {
    const box = boxSize(label);
    return BOX_SHAPES.has(look.shape) ? box : { w: Math.round(box.w * 1.5), h: box.h + 6 };
  }
  const side = look.style === "title" ? TITLE_SIZE : NAME_SIZE;
  return { w: side, h: side };
}

export function nodeGem(look: NodeLook, size: { w: number; h: number }): Gem {
  return gem({ shape: look.shape, color: look.color, ...size, glass: look.style === "statement" });
}

// ---- Edges ----

export interface EdgeLook {
  name: string;
  /** What the key calls it. */
  label: string;
  color: string;
  width: number;
  line: "solid" | "double" | "dashed" | "dotted";
  arrow: "triangle" | "tee" | "circle";
  /** Printed on the edge. */
  mark?: string;
}

/** Each look differs in line and arrowhead as well as colour. */
export const EDGE_LOOKS: EdgeLook[] = [
  { name: "plain", label: "Other link", color: "#aa9c8a", width: 1.3, line: "solid", arrow: "triangle" },
  { name: "builds-on", label: "Builds on", color: "#685c4f", width: 3.6, line: "double", arrow: "triangle" },
  { name: "increases", label: "Increases", color: "#c06b49", width: 2, line: "solid", arrow: "triangle", mark: "+" },
  { name: "decreases", label: "Decreases", color: "#4f7391", width: 2, line: "dashed", arrow: "tee", mark: "−" },
  { name: "part-of", label: "Part of", color: MUTED, width: 1.6, line: "dotted", arrow: "circle" },
];

/** Which look an edge of this Role (and, for causal edges, sign) gets. */
export function edgeLookOf(role: string, sign?: number): string {
  if (role === "derivational") return "builds-on";
  if (role === "causal") return sign === -1 ? "decreases" : "increases";
  return role === "identity" ? "part-of" : "plain";
}

// ---- Stylesheet ----

const nodeRules: StylesheetJson = [
  {
    selector: "node",
    style: {
      shape: "data(shape)" as never,
      width: "data(w)",
      height: "data(h)",
      "background-opacity": 0,
      "border-width": 0,
      "background-image": "data(image)",
      "background-width": "data(imageW)",
      "background-height": "data(imageH)",
      "background-clip": "none",
      "background-image-containment": "over",
      "bounds-expansion": 12,
      label: "data(label)",
      "font-size": 11,
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      color: INK,
      "text-wrap": "wrap",
      "text-max-width": "110px",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "text-outline-color": PAPER,
      "text-outline-width": 2,
      "text-outline-opacity": 0.85,
    },
  },
  { selector: "node.style-name", style: { "font-weight": 600 } },
  { selector: "node.style-title", style: { "font-style": "italic" } },
  {
    selector: "node.style-statement",
    style: { "text-valign": "center", "text-margin-y": 0, "text-max-width": `${BOX_TEXT_WIDTH}px`, "font-family": "ui-serif, Georgia, serif", "font-size": 11.5, "text-outline-width": 0 },
  },
  // Confirmed by the person: a ring around the stone. Removed (shown on request): faded, with a dashed ring.
  { selector: "node.confirmed", style: { "outline-width": 1.5, "outline-color": "data(color)", "outline-offset": 3, "outline-opacity": 0.8 } },
  { selector: "node.removed", style: { "background-image-opacity": 0.35, color: MUTED, "outline-width": 1, "outline-style": "dashed", "outline-color": MUTED, "outline-offset": 3, "outline-opacity": 0.8 } },
  { selector: "node.appeared", style: { "underlay-color": "#8ea27f", "underlay-opacity": 0.3, "underlay-padding": 8, "underlay-shape": "ellipse" } },
  { selector: "node:selected", style: { "underlay-color": "#2a241f", "underlay-opacity": 0.16, "underlay-padding": 8, "underlay-shape": "ellipse" } },
  { selector: "node.style-statement:selected", style: { "underlay-shape": "round-rectangle" } },
  { selector: "node.highlight", style: { "outline-width": 3, "outline-color": HIGHLIGHT, "outline-style": "solid", "outline-offset": 3, "outline-opacity": 1 } },
];

const lookRules: StylesheetJson = EDGE_LOOKS.map((look) => ({
  selector: `edge.look-${look.name}`,
  style: {
    width: look.width,
    "line-color": look.color,
    "line-style": look.line,
    "line-dash-pattern": [6, 4],
    "target-arrow-color": look.color,
    "target-arrow-shape": look.arrow,
    "arrow-scale": look.arrow === "triangle" ? 0.8 : 0.7,
    color: look.color,
    "font-weight": look.mark ? 700 : 400,
    "font-size": look.mark ? 13 : 9,
  },
}));

const edgeRules: StylesheetJson = [
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "line-outline-width": 1,
      "line-outline-color": PAPER,
      label: "data(label)",
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "text-background-color": PAPER,
      "text-background-opacity": 0.92,
      "text-background-shape": "roundrectangle",
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
  ...lookRules,
  { selector: "edge.removed", style: { opacity: 0.3 } },
  { selector: "edge:selected", style: { "underlay-color": "#2a241f", "underlay-opacity": 0.14, "underlay-padding": 5 } },
  { selector: "edge.highlight", style: { "line-color": HIGHLIGHT, "target-arrow-color": HIGHLIGHT, width: 3.5 } },
];

export const GRAPH_STYLE: StylesheetJson = [...nodeRules, ...edgeRules];
