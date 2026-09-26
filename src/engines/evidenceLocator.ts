// Turns quoted passages into byte-range Evidence pointers. Quotes that cannot be found in
// the Entry are dropped, so an assertion can never cite text that is not there.
import type { Evidence } from "../core/types.js";
import { byteOffset } from "../utilities/crypto.js";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fuzzyMatch(text: string, quote: string): { index: number; length: number } | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  if (words.length === 0) return null;
  const match = new RegExp(words.join("\\s+"), "i").exec(text);
  return match ? { index: match.index, length: match[0].length } : null;
}

export function locate(text: string, quote: string): { index: number; length: number } | null {
  if (quote.trim().length === 0) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0) return { index: exact, length: quote.length };
  return fuzzyMatch(text, quote);
}

export function quoteToEvidence(entry: string, text: string, quote: string): Evidence | null {
  const found = locate(text, quote);
  if (!found) return null;
  return {
    entry,
    start: byteOffset(text, found.index),
    end: byteOffset(text, found.index + found.length),
  };
}

export function quotesToEvidence(entry: string, text: string, quotes: string[]): Evidence[] {
  return quotes.map((q) => quoteToEvidence(entry, text, q)).filter((e): e is Evidence => e !== null);
}
