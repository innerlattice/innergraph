// The design tokens the canvas and icons need as numbers or strings, rather than as classes.
// Colours mirror index.css's @theme (a test keeps them in step); sizes are CSS pixels.

/** The palette entries the graph canvas draws with. */
export const COLOR = {
  paper: "#f8f4ee",
  ink: "#3b332b",
  muted: "#867867",
  faint: "#aa9c8a",
  strong: "#685c4f",
  deep: "#2a241f",
  rule: "#d7cbbb",
  clay: "#c06b49",
  sage: "#8ea27f",
  slate: "#4f7391",
  highlight: "#d4a017",
} as const;

/** Which @theme variable each canvas colour is. */
export const COLOR_VARIABLE: Record<keyof typeof COLOR, string> = {
  paper: "--color-paper",
  ink: "--color-stone-800",
  muted: "--color-stone-500",
  faint: "--color-stone-400",
  strong: "--color-stone-600",
  deep: "--color-stone-900",
  rule: "--color-stone-300",
  clay: "--color-clay-500",
  sage: "--color-sage-400",
  slate: "--color-slate-600",
  highlight: "--color-highlight",
};

/** Node-type colours, handed out in schema order: muted, warm and told apart by shape as well. */
export const TYPE_PALETTE = ["#7c9885", "#b08968", "#8e7dbe", "#c97b84", "#5f8fa8", "#a3a35c", "#d4a373", "#6d8a96", "#9c6644", "#7a7aa8"];

/** Icon and glyph sizes: `xs` inside chips, `sm` beside small text, `md` in buttons, `lg` and `xl` on their own. */
export const ICON = { xs: 10, sm: 12, md: 14, lg: 16, xl: 18 } as const;
