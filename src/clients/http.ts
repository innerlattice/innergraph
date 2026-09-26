// HTTP Client for the desktop UI. Calls Managers only.
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { InvariantError } from "../access/invariants.js";
import { SchemaError } from "../access/schemaAccess.js";
import { VIEW_STATUSES, type ViewStatus } from "../access/view.js";
import { ChatFullError } from "../managers/chatManager.js";
import { ForbiddenError, NotFoundError, requireFound } from "../managers/sessions.js";
import type { Vault } from "../vault.js";
import { respondToChat } from "./chat.js";

const ERROR_STATUS: [new (...args: never[]) => Error, ContentfulStatusCode][] = [
  [NotFoundError, 404],
  [ChatFullError, 409],
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

/** `?statuses=active,removed` → the View filter; unknown words are ignored. */
export function statusesOf(c: Context): ViewStatus[] | undefined {
  const raw = c.req.query("statuses");
  return raw ? raw.split(",").filter((s): s is ViewStatus => (VIEW_STATUSES as readonly string[]).includes(s)) : undefined;
}

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
  app.get("/api/view", route((c) => explore.view({ statuses: statusesOf(c), at: c.req.query("t") || undefined })));
  app.get("/api/nodes/:id", route((c) => explore.node(c.req.param("id") ?? "", { statuses: statusesOf(c) })));
  app.get("/api/edges/:id", route((c) => explore.edge(c.req.param("id") ?? "")));
  app.get("/api/nodes/:id/roots", route((c) => explore.traceRoots(c.req.param("id") ?? "")));
  app.get("/api/nodes/:id/related", route((c) => explore.findRelated({ nodeId: c.req.param("id") })));
  app.get("/api/loops", route(() => explore.loopDetails()));
  app.get("/api/groups", route(() => explore.groups()));
  app.get("/api/entries", route(() => explore.entries()));
  app.get("/api/entries/:id", route((c) => explore.entry(c.req.param("id") ?? "")));
  app.get("/api/search", route((c) => explore.searchEvidence(c.req.query("q") ?? "")));
  app.get("/api/search/graph", route((c) => explore.searchGraph(c.req.query("q") ?? "", Number(c.req.query("limit") ?? 10))));
  app.get("/api/timeline", route(() => explore.timeline()));
  app.get("/api/revert/preview", route((c) => map.revertPreview(c.req.query("t") ?? "")));
  app.get("/api/duplicates", route(() => map.duplicates()));
  app.get("/api/changes", route((c) => explore.changes(Number(c.req.query("limit") ?? 30))));
  app.get("/api/selection", route(() => explore.selection()));
  app.get("/api/stream", (c) => streamPositions(c, vault));
  app.get("/api/jobs/:id", route((c) => requireFound(ingest.job(c.req.param("id") ?? ""), "Job")));
}

function registerWrites(app: Hono, vault: Vault): void {
  const { map, ingest } = vault;
  app.post("/api/entries", route(async (c) => {
    const input = await body(c);
    return ingest.addEntry(input, { interpret: input.interpret !== false });
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
  app.post("/api/duplicates/merge", route(async (c) => map.mergeDuplicates("user", (await body(c)).groups ?? undefined)));
  app.post("/api/undo", route(async (c) => map.undo((await body(c)).eventId)));
  app.post("/api/restore", route(async (c) => map.restore((await body(c)).id)));
  app.post("/api/revert", route(async (c) => map.revert((await body(c)).t)));
  app.post("/api/remove", route(async (c) => map.remove((await body(c)).ids ?? [])));
  app.post("/api/confirm", route(async (c) => map.confirm((await body(c)).ids ?? [])));
  app.post("/api/undo-session", route(async (c) => map.undoSession((await body(c)).session)));
  app.put("/api/selection", route(async (c) => vault.explore.setSelection((await body(c)).ids ?? [])));
  app.post("/api/related", route(async (c) => vault.explore.findRelated({ text: (await body(c)).text })));
}

function registerChat(app: Hono, vault: Vault): void {
  const { chat } = vault;
  const id = (c: Context) => c.req.param("id") ?? "";
  app.get("/api/chats", route(() => chat.list()));
  app.post("/api/chats", route(async (c) => chat.create(undefined, (await body(c)).title)));
  app.get("/api/chats/:id", route((c) => chat.get(id(c))));
  app.patch("/api/chats/:id", route(async (c) => chat.rename(id(c), (await body(c)).title ?? "")));
  app.delete("/api/chats/:id", route((c) => chat.remove(id(c))));
  app.get("/api/chat/settings", route(() => chat.publicSettings()));
  app.put("/api/chat/settings", route(async (c) => chat.updateSettings(await body(c))));
  app.post("/api/chat", async (c) => {
    try {
      return await respondToChat(vault, await body(c));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, statusFor(error));
    }
  });
}

export function createApp(vault: Vault): Hono {
  const app = new Hono();
  registerReads(app, vault);
  registerWrites(app, vault);
  registerChat(app, vault);
  return app;
}
