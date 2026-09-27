# Design principles

Inner Graph should feel calm, warm and a little delightful: a place people want to come back to.
These principles hold across the app. When a change breaks one, change the principle here first.

## Meaning never rests on colour alone

Every semantic difference that colour carries is carried a second way too: shape, line style,
an icon, a word or position. Node types have both a colour and a shape. An increase and a
decrease differ in colour, arrowhead and line. This keeps the app readable for colour-blind
people, in greyscale and at a glance, and the shapes give the map much of its character. No two
node types share a shape.

## The expected case looks like nothing

Mark the exception, not the norm. Most things on the map will be confirmed, so confirmed looks
like nothing at all; only a removed item, a fresh change or a highlight earns a mark. Every ring,
badge and pill has to earn its place against the clutter it adds.

## No `·` separators

Never string items together with middle dots ("belief · 70% · by you"). A row of dots is hard to
scan: every item has the same weight and nothing says which is which. Instead:

- lay items out as separate elements with space between them (`components/ItemMeta.tsx`: the kind with its glyph, a confidence meter, "Added by"),
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

Elevation has five levels (shadow tokens in `index.css`):

- `shadow-inset`: pressed into the page, for secondary detail that should recede, like the
  record of what the assistant changed in a chat
- surface: no shadow; the page itself and regions set apart by tone
- `shadow-raised`: cards, chips and buttons lying on the page
- `shadow-floating`: popovers, the graph key, floating panels, a button under the pointer
- `shadow-lifted`: something being dragged, or a dialog above everything

Choose the level by how much something should draw the eye, not by what it is. In a
conversation about someone's life, the words come first; the machinery sits lower.

## The graph looks like gems

Nodes are small cut stones seen from above: a flat table in the middle and a ring of crown facets
sloping down to the girdle, each facet flat-shaded by the same overhead light, with a warm
shadow on the paper beneath. The faceting is what makes them read as stone rather than as glossy
buttons, so keep it crisp: flat facets and a fine dark edge, no blurred gloss or white rims.
Statement nodes are cut from pale tinted glass with a wide table that holds their text. Colours
stay in the warm, muted palette, not saturated primaries. Adding to the map should feel rewarding.

Shapes are true to their geometry: a hexagon or triangle is regular, not stretched to a square,
and a slanted shape leans gently whatever its width.

Labels use two faces: the sans for names and titles (names bold, titles plain) and the serif for
statements, which read as something said. The key sets each type's name in its map face.

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
