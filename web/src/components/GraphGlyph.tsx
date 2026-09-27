// The graph's pieces as small page elements, drawn from the same design system as the canvas so
// the key and panels always match the map.
import type { EdgeLook, NodeLook } from "../design/graph";
import { nodeGem } from "../design/graph";

/** A node type's gem at icon size. Its shadow spills into the surrounding space, not the layout. */
export function NodeGlyph(props: { look: NodeLook; size?: number }) {
  const h = props.size ?? 14;
  const w = props.look.style === "statement" ? Math.round(h * 1.5) : h;
  const g = nodeGem(props.look, { w, h });
  return <img src={g.uri} alt="" aria-hidden="true" width={g.width} height={g.height} className="shrink-0" style={{ margin: `${-(g.height - h) / 2}px ${-(g.width - w) / 2}px` }} />;
}

const DASH = { solid: undefined, double: undefined, dashed: "5 3", dotted: "0.1 3.4" };

function Arrow(props: { look: EdgeLook; x: number }) {
  const { look, x } = props;
  if (look.arrow === "tee") return <line x1={x} y1={2} x2={x} y2={10} stroke={look.color} strokeWidth={2} strokeLinecap="round" />;
  if (look.arrow === "circle") return <circle cx={x} cy={6} r={2.6} fill={look.color} />;
  return <path d={`M${x - 6},2.5 L${x},6 L${x - 6},9.5 Z`} fill={look.color} />;
}

/** A short sample of an edge: its line type, colour and arrowhead. */
export function EdgeGlyph(props: { look: EdgeLook }) {
  const { look } = props;
  const end = look.arrow === "triangle" ? 28 : 30;
  const line = (y: number, width: number) => <line x1={2} y1={y} x2={end} y2={y} stroke={look.color} strokeWidth={width} strokeDasharray={DASH[look.line]} strokeLinecap="round" />;
  return (
    <svg width={36} height={12} viewBox="0 0 36 12" aria-hidden="true" className="shrink-0">
      {look.line === "double" ? (
        <>
          {line(4.4, 1.1)}
          {line(7.6, 1.1)}
        </>
      ) : (
        line(6, Math.max(1.4, look.width))
      )}
      <Arrow look={look} x={look.arrow === "triangle" ? 34 : 32} />
    </svg>
  );
}
