// A node drawn as a small cut stone: a lit top, a deeper base, a soft highlight and a warm shadow
// on the paper beneath. Statement nodes are panes of tinted glass. Rendered as an SVG data URI so
// the canvas (as a node background) and the page (as an <img>) show exactly the same thing.
import { shapeElement } from "./shapes";

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

function mix(hex: string, toward: string, amount: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(hex);
  const b = parse(toward);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const lighten = (hex: string, amount: number) => mix(hex, "#ffffff", amount);
const darken = (hex: string, amount: number) => mix(hex, "#000000", amount);

/** Body stops, top to bottom, and how strong the highlight and shadow are. */
function palette(color: string, glass: boolean) {
  if (glass) return { top: lighten(color, 0.9), mid: lighten(color, 0.82), base: lighten(color, 0.7), shine: 0.55, shadow: 0.16 };
  return { top: lighten(color, 0.38), mid: color, base: darken(color, 0.22), shine: 0.7, shadow: 0.32 };
}

function gemBody(spec: GemSpec, blur: number, drop: number): string {
  const p = palette(spec.color, spec.glass ?? false);
  const shape = shapeElement(spec.shape, spec.w, spec.h);
  const top = -spec.h / 2;
  return [
    "<defs>",
    `<linearGradient id="b" x1="0" y1="${top}" x2="0" y2="${-top}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.top}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.base}"/></linearGradient>`,
    `<radialGradient id="s" cx=".34" cy=".22" r=".5"><stop offset="0" stop-color="#fff" stop-opacity="${p.shine}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter>`,
    `<clipPath id="c">${shape}/></clipPath>`,
    "</defs>",
    `<g transform="translate(0 ${drop})" filter="url(#f)" opacity="${p.shadow}">${shape} fill="${SHADOW}"/></g>`,
    `${shape} fill="url(#b)"/>`,
    `<g clip-path="url(#c)">${shape} fill="url(#s)"/>${shape} fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="${Math.max(1, spec.h / 20)}"/></g>`,
  ].join("");
}

const cache = new Map<string, Gem>();

/** The gem for a node of this shape, colour and size. Cached: most nodes share a few looks. */
export function gem(spec: GemSpec): Gem {
  const key = `${spec.shape}|${spec.color}|${spec.w}|${spec.h}|${spec.glass ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = Math.min(spec.w, spec.h);
  const blur = Math.max(1.2, size * 0.07);
  const drop = Math.max(1.5, size * 0.09);
  const margin = Math.ceil(drop + blur * 3);
  const width = spec.w + 2 * margin;
  const height = spec.h + 2 * margin;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * DENSITY}" height="${height * DENSITY}" viewBox="${-width / 2} ${-height / 2} ${width} ${height}">${gemBody(spec, blur, drop)}</svg>`;
  const made = { uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, width, height };
  cache.set(key, made);
  return made;
}
