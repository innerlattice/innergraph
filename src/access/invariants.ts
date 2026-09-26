// Log invariants enforced at the append boundary.
import { type AnyDraft, USER } from "../core/types.js";

export class InvariantError extends Error {}

function isAssertion(draft: AnyDraft): draft is Extract<AnyDraft, { type: "NodeAsserted" | "EdgeAsserted" }> {
  return draft.type === "NodeAsserted" || draft.type === "EdgeAsserted";
}

export function checkDraft(draft: AnyDraft): void {
  if (!draft.session) throw new InvariantError(`${draft.type} has no session`);
  if (!isAssertion(draft)) return;
  const { confidence, evidence, id } = draft.body;
  if (!(confidence >= 0 && confidence <= 1)) {
    throw new InvariantError(`${id}: confidence must be within 0..1`);
  }
  if (draft.actor !== USER && evidence.length === 0) {
    throw new InvariantError(`${id}: agent assertions need at least one Evidence pointer`);
  }
}
