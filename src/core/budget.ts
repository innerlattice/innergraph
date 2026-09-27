// How full a conversation is, as one rule the server enforces and the UI shows: warned from 70%
// of the model's context window, no more turns from 90%.
export type BudgetLevel = "ok" | "warn" | "full";

export const WARN_AT = 0.7;
const FULL_AT = 0.9;

export function budgetLevel(contextTokens: number, contextWindow: number): BudgetLevel {
  const share = contextWindow > 0 ? contextTokens / contextWindow : 0;
  if (share >= FULL_AT) return "full";
  return share >= WARN_AT ? "warn" : "ok";
}
