# Design principles

Inner Graph should feel calm, warm and a little delightful: a place people want to come back to.
These principles hold across the app. When a change breaks one, change the principle here first.

## Meaning never rests on colour alone

Every semantic difference that colour carries is carried a second way too: shape, line style,
an icon, a word or position. Node types have both a colour and a shape. An increase and a
decrease differ in colour, arrowhead and line. A confirmed item gains a ring as well as a tint. This keeps
the app readable for colour-blind people, in greyscale and at a glance, and the shapes give the
map much of its character.

## No `·` separators

Never string items together with middle dots ("belief · 70% · by you"). A row of dots is hard to
scan: every item has the same weight and nothing says which is which. Instead:

- lay items out as separate elements with space between them (`Meta` in `components/ui.tsx`),
- give each item a label or icon when it isn't obvious what it is,
- use a list when there are more than two or three things (the graph key), or
- write a sentence ("Saved as “Tuesday”", "gemma, private to this device").

## Depth from light, not lines

Use few borders. Borders cut information into boxes and make an interface look cheap and busy.
Show that something sits above something else with soft, physically plausible shadows: light
comes from above, so shadows fall slightly downward, are wider and fainter the higher a surface
floats, and are warm-tinted rather than grey. Separate regions with space and a change in
surface tone before reaching for a line.

Borders are still right for a few things: text inputs, which need a visible edge to invite typing,
and dashed outlines that mean "empty" or "drop here".

Shadow scale (Tailwind tokens in `index.css`):

- `shadow-rest`: cards and chips lying on the page
- `shadow-float`: popovers, the graph key, floating panels
- `shadow-lift`: something being dragged or hovered to act on

## The graph looks like gems

Nodes are small cut stones: a lit top, a deeper base, a soft highlight and a shadow on the paper
beneath. Statement nodes are panes of tinted glass holding their text. It should look a little like
candy or a jewel box, but restrained: the gloss is subtle and the colours are the warm, muted
palette, not saturated primaries. The aim is that adding to the map feels rewarding.

Edges get their meaning from line type as well as colour:

| Look         | Line                 | End               |
| ------------ | -------------------- | ----------------- |
| other        | thin, solid          | small arrow       |
| builds on    | double               | arrow             |
| increases    | solid, clay          | arrow, `+` label  |
| decreases    | dashed, slate        | flat bar, `−` label |
| part of      | dotted               | dot, no arrow     |

## Graph pieces are design-system components

The look of nodes and edges lives in one folder, `web/src/design/`: `shapes.ts` draws the node
outlines, `gem.ts` renders them as stones, and `graph.ts` holds node sizes, the edge looks and the
Cytoscape stylesheet. `NodeGlyph` and `EdgeGlyph` (`components/GraphGlyph.tsx`) read from the same
place, so the key, panels and canvas can't drift apart, and restyling the graph means editing that
folder alone.
