// A node drawn as a cut stone seen from above: a flat table in the middle, a ring of crown facets
// sloping down to the girdle, each facet flat-shaded by a light from above, and a warm
// shadow on the paper beneath. Statement nodes are cut from pale glass with a wide table for their
// text. Rendered as an SVG data URI so the canvas (as a node background) and the page (as an <img>)
// show exactly the same thing.
import { type Point, cornersOf, polygonPath, roundedPath } from "./shapes";

export interface GemSpec {
  shape: string;
  color: string;
  w: number;
  h: number;
  /** Pale, see-through body for nodes that hold text. */
  glass?: boolean;
}

export interface Gem {
  uri: string;
  /** The image's size, larger than the node so the shadow has room. */
  width: number;
  height: number;
}

/** Warm, dark brown: shadows on paper are never neutral grey. */
const SHADOW = "#4a3526";
/** Extra resolution so gems stay crisp when the map is zoomed in. */
const DENSITY = 4;
/** Where the light comes from: straight above, as for every shadow on the page. */
const LIGHT: Point = [0, -1];
/** How wide the crown is on a glass stone, so the table stays big enough for text. */
const GLASS_BEVEL = 4;
/** How much of a small stone's width is table. */
const TABLE = 0.5;

function mix(hex: string, toward: string, amount: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(hex);
  const b = parse(toward);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** `amount` > 0 towards white, < 0 towards black. */
const shade = (hex: string, amount: number) => (amount >= 0 ? mix(hex, "#ffffff", amount) : mix(hex, "#000000", -amount));

/** The colour a stone is cut from: glass is the tint of its colour on white. */
const bodyOf = (spec: GemSpec) => (spec.glass ? shade(spec.color, 0.45) : spec.color);

/** The table: the outline shrunk towards its centre, by a fixed bevel for glass or a fraction for stones. */
function tableOf(outer: Point[], spec: GemSpec): Point[] {
  const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
  const cy = outer.reduce((s, p) => s + p[1], 0) / outer.length;
  const sx = spec.glass ? (spec.w - 2 * GLASS_BEVEL) / spec.w : TABLE;
  const sy = spec.glass ? (spec.h - 2 * GLASS_BEVEL) / spec.h : TABLE;
  return outer.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}

/** How directly a facet facing outward along the edge a→b catches the light, -1..1. */
function lit(a: Point, b: Point): number {
  const nx = b[1] - a[1];
  const ny = a[0] - b[0];
  const len = Math.hypot(nx, ny) || 1;
  return (nx * LIGHT[0] + ny * LIGHT[1]) / len;
}

/** Each crown facet is split into two triangles, the second a touch darker, as a real cut would catch it. */
function crown(outer: Point[], table: Point[], body: string, glass: boolean): string {
  const range = glass ? 0.3 : 0.38;
  return outer
    .map((a, i) => {
      const j = (i + 1) % outer.length;
      const tone = lit(a, outer[j]) * range;
      const first = polygonPath([a, outer[j], table[j]]);
      const second = polygonPath([a, table[j], table[i]]);
      return `<path d="${first}" fill="${shade(body, tone)}"/><path d="${second}" fill="${shade(body, tone - 0.07)}"/>`;
    })
    .join("");
}

/** The flat top: lit a little from above, and for glass, almost clear so text reads. */
function tableFill(spec: GemSpec, body: string): string {
  const top = spec.glass ? shade(body, 0.74) : shade(body, 0.16);
  const bottom = spec.glass ? shade(body, 0.6) : shade(body, -0.06);
  return `<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
}

function gemBody(spec: GemSpec, blur: number, drop: number): string {
  const outer = cornersOf(spec.shape, spec.w, spec.h);
  const table = tableOf(outer, spec);
  const body = bodyOf(spec);
  const outline = roundedPath(outer, Math.min(spec.w, spec.h) / 14);
  const edge = shade(spec.color, -0.35);
  const hair = Math.max(0.35, Math.min(spec.w, spec.h) / 60);
  return [
    "<defs>",
    tableFill(spec, body),
    `<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter>`,
    `<clipPath id="c"><path d="${outline}"/></clipPath>`,
    "</defs>",
    `<path d="${outline}" transform="translate(0 ${drop})" filter="url(#f)" fill="${SHADOW}" opacity="${spec.glass ? 0.16 : 0.3}"/>`,
    `<g clip-path="url(#c)">`,
    crown(outer, table, body, spec.glass ?? false),
    `<path d="${polygonPath(table)}" fill="url(#t)" stroke="#fff" stroke-opacity=".5" stroke-width="${hair}"/>`,
    "</g>",
    `<path d="${outline}" fill="none" stroke="${edge}" stroke-opacity="${spec.glass ? 0.35 : 0.5}" stroke-width="${hair}"/>`,
  ].join("");
}

const cache = new Map<string, Gem>();

/** The gem for a node of this shape, colour and size. Cached: most nodes share a few looks. */
export function gem(spec: GemSpec): Gem {
  const key = `${spec.shape}|${spec.color}|${spec.w}|${spec.h}|${spec.glass ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = Math.min(spec.w, spec.h);
  const blur = Math.max(1.2, size * 0.06);
  const drop = Math.max(1.5, size * 0.08);
  const margin = Math.ceil(drop + blur * 3);
  const width = spec.w + 2 * margin;
  const height = spec.h + 2 * margin;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * DENSITY}" height="${height * DENSITY}" viewBox="${-width / 2} ${-height / 2} ${width} ${height}">${gemBody(spec, blur, drop)}</svg>`;
  const made = { uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, width, height };
  cache.set(key, made);
  return made;
}
