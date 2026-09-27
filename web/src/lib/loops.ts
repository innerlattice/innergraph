// Gentle, theory-free observations about a loop's structure. Offered, never verdicts.
import type { LoopView } from "../api";
import { pct } from "./format";

const POLARITY: Record<LoopView["polarity"], string> = {
  reinforcing: "Each step strengthens the next, so this pattern can escalate or entrench. Easing any one step would slow the whole loop.",
  balancing: "This loop pushes back against change and tends to hold things steady; a push on one part may be met by the rest.",
};

export function implications(loop: LoopView): string[] {
  const brakes = loop.inputs.filter((s) => s.sign === -1).map((s) => `“${s.fromLabel}” dampens “${s.toLabel}” from outside the loop: an existing brake.`);
  const accelerators = loop.inputs.filter((s) => s.sign === 1).map((s) => `“${s.fromLabel}” feeds “${s.toLabel}” from outside the loop.`);
  const weakest = loop.weakest.confidence < 0.6 ? [`The least certain link is ${loop.weakest.fromLabel} → ${loop.weakest.toLabel} (${pct(loop.weakest.confidence)}). Does it match your sense?`] : [];
  const tentative = loop.certainty < 0.3 ? ["Taken together, this loop is still tentative."] : [];
  return [POLARITY[loop.polarity], ...brakes, ...accelerators, ...weakest, ...tentative];
}

export function loopFocus(loop: LoopView): string {
  return [...loop.nodes, ...loop.edges].join(",");
}

