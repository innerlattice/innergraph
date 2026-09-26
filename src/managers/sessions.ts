// Helpers shared by Managers for bounded Sessions. Not a Manager itself.
import type { VaultAccess } from "../access/vaultAccess.js";
import type { ActorId, AnyDraft, AnyEvent } from "../core/types.js";
import { newId } from "../utilities/crypto.js";

/** Appends `drafts` wrapped in SessionOpened / SessionClosed as one atomic unit. */
export function runSession(
  vault: VaultAccess,
  actor: ActorId,
  purpose: string,
  drafts: (session: string) => AnyDraft[],
): { session: string; events: AnyEvent[] } {
  const session = newId();
  const events = vault.append([
    { actor, session, type: "SessionOpened", body: { purpose } },
    ...drafts(session),
    { actor, session, type: "SessionClosed", body: {} },
  ]);
  return { session, events };
}

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export function requireFound<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new NotFoundError(`${what} not found`);
  return value;
}
