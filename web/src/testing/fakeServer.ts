// A stand-in for the HTTP API in web tests: `fetch` answers from a handler, and every call is
// recorded so a test can check what the page sent.
import { vi } from "vitest";

export interface Call {
  method: string;
  url: string;
  /** The URL without its query. */
  path: string;
  body?: unknown;
}

/** A value to send as JSON, a Response as is, or undefined for 404. */
export type Handler = (call: Call) => unknown;

export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** What the API sends when a request fails. */
export const failure = (error: string, status = 400) => json({ error }, status);

/** Stubs fetch with `handler` (restore with vi.unstubAllGlobals) and returns the calls made. */
export function fakeServer(handler: Handler): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const call = { method: init?.method ?? "GET", url, path: url.split("?")[0], body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const reply = handler(call);
    if (reply instanceof Response) return reply;
    return reply === undefined ? failure("missing", 404) : json(reply);
  });
  return calls;
}

/** What the page sent, as { url: path, body }. */
export const sent = (calls: Call[]) => calls.filter((c) => c.method !== "GET").map((c) => ({ url: c.path, body: c.body }));
