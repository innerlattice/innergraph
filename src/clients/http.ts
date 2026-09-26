// HTTP Client for the desktop UI. Calls Managers only.
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { InvariantError } from "../access/invariants.js";
import { SchemaError } from "../access/schemaAccess.js";
import type { Status } from "../core/types.js";
import { ForbiddenError, NotFoundError, requireFound } from "../managers/sessions.js";
import type { Vault } from "../vault.js";

const ERROR_STATUS: [new (...args: never[]) => Error, ContentfulStatusCode][] = [
  [NotFoundError, 404],
  [ForbiddenError, 403],
  [SchemaError, 400],
  [InvariantError, 400],
];

export function statusFor(error: unknown): ContentfulStatusCode {
  return ERROR_STATUS.find(([type]) => error instanceof type)?.[1] ?? 400;
}

type Handler = (c: Context) => unknown;

function route(handler: Handler) {
  return async (c: Context) => {
    try {
      return c.json((await handler(c)) ?? { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, statusFor(error));
    }
  };
}

const body = (c: Context) => c.req.json();

const STREAM_INTERVAL_MS = 400;

/** Server-sent events: emits the Log position whenever any process appends, so views update live. */
export function streamPositions(c: Context, vault: Vault, intervalMs = STREAM_INTERVAL_MS) {
  return streamSSE(c, async (stream) => {
    let last = "";
    while (!stream.aborted) {
      const position = vault.explore.position();
      if (position !== last) await stream.writeSSE({ event: "position", data: position });
      last = position;
      await stream.sleep(intervalMs);
    }
  });
}

function registerReads(app: Hono, vault: Vault): void {
  const { explore, map, ingest } = vault;
  app.get("/api/status", route(() => ({ model: vault.gateway.name, hosted: vault.gateway.hosted, schema: explore.schema() })));
  app.get("/api/schema", route(() => explore.schema()));
  app.get("/api/graph", route((c) => explore.graph({ includeSuperseded: c.req.query("superseded") === "1" })));
  app.get("/api/graph/at", route((c) => map.graphAt(c.req.query("t") ?? "")));
  app.get("/api/diff", route((c) => map.diff(c.req.query("from") ?? "", c.req.query("to") ?? "")));
  app.get("/api/positions", route(() => map.positions()));
  app.get("/api/nodes/:id", route((c) => explore.node(c.req.param("id") ?? "")));
  app.get("/api/nodes/:id/roots", route((c) => explore.traceRoots(c.req.param("id") ?? "")));
  app.get("/api/nodes/:id/related", route((c) => explore.findRelated({ nodeId: c.req.param("id") })));
  app.get("/api/loops", route(() => explore.findLoops()));
  app.get("/api/groups", route(() => explore.groups()));
  app.get("/api/entries", route(() => explore.entries()));
  app.get("/api/entries/:id", route((c) => explore.entry(c.req.param("id") ?? "")));
  app.get("/api/search", route((c) => explore.searchEvidence(c.req.query("q") ?? "")));
  app.get("/api/timeline", route(() => explore.timeline()));
  app.get("/api/pending", route(() => ingest.pendingChanges()));
  app.get("/api/selection", route(() => explore.selection()));
  app.get("/api/stream", (c) => streamPositions(c, vault));
  app.get("/api/jobs/:id", route((c) => requireFound(ingest.job(c.req.param("id") ?? ""), "Job")));
  app.get("/api/proposals", route((c) => ingest.listProposals(c.req.query("filter") === "all" ? "all" : "pending")));
  app.get("/api/proposals/:session", route((c) => ingest.proposal(c.req.param("session") ?? "")));
}

function registerWrites(app: Hono, vault: Vault): void {
  const { map, ingest } = vault;
  app.post("/api/entries", route(async (c) => {
    const input = await body(c);
    return ingest.addEntry(input, { interpret: input.interpret !== false });
  }));
  app.post("/api/proposals/:session/review", route(async (c) => ingest.review(c.req.param("session") ?? "", await body(c))));
  app.post("/api/items/:id/status", route(async (c) => {
    const input = (await body(c)) as { status: Status; reason?: string };
    return map.setStatus(c.req.param("id") ?? "", input.status, "user", input.reason);
  }));
  app.post("/api/items/:id/attributes", route(async (c) => map.changeAttributes(c.req.param("id") ?? "", await body(c))));
  app.post("/api/nodes/:id/split", route(async (c) => map.split(c.req.param("id") ?? "", (await body(c)).parts)));
  app.post("/api/merge", route(async (c) => {
    const input = await body(c);
    return map.merge(input.sources, input.into);
  }));
  app.post("/api/entries/:id/revise", route(async (c) => {
    const input = await body(c);
    return ingest.reviseEntry(c.req.param("id") ?? "", input.content, { interpret: input.interpret !== false });
  }));
  app.post("/api/approve", route(async (c) => ingest.approve((await body(c)).ids ?? [])));
  app.post("/api/decline", route(async (c) => ingest.decline((await body(c)).ids ?? [])));
  app.put("/api/selection", route(async (c) => vault.explore.setSelection((await body(c)).ids ?? [])));
  app.post("/api/related", route(async (c) => vault.explore.findRelated({ text: (await body(c)).text })));
}

export function createApp(vault: Vault): Hono {
  const app = new Hono();
  registerReads(app, vault);
  registerWrites(app, vault);
  return app;
}
