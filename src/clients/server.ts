// The app's local server: the HTTP API and the built web app on 127.0.0.1, for the CLI's `serve`
// and the desktop app alike.
import { existsSync } from "node:fs";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadSchemaFile } from "../access/schemaAccess.js";
import { PATHS, VERSION } from "../paths.js";
import type { Vault } from "../vault.js";
import type { Runner } from "./connect.js";
import { createApp } from "./http.js";

type App = ReturnType<typeof createApp>;

export interface ServerOptions {
  vault: Vault;
  /** The Vault's folder, for the MCP setup other agents are shown. */
  vaultDir: string;
  port: number;
  /** How other agents start this program to reach the map over MCP. */
  runner: Runner;
  /** Take any free port when `port` is in use, rather than failing. */
  anyPort?: boolean;
  web?: string;
}

export interface LocalServer {
  url: string;
  stop(): Promise<void>;
}

function listen(fetch: (request: Request) => Response | Promise<Response>, port: number): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname: "127.0.0.1" }, (info) => resolve({ server, port: info.port }));
    server.once("error", reject);
  });
}

/** Hashed bundles never change, so browsers keep them; index.html is rechecked on every load so a rebuild's new bundle is picked up. */
function cacheControlFor(requestPath: string): string {
  return requestPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

export function serveWeb(app: App, web: string): void {
  app.use("/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", cacheControlFor(c.req.path));
  });
  app.use("/*", serveStatic({ root: web }));
}

export async function startServer(options: ServerOptions): Promise<LocalServer> {
  const { vault } = options;
  // A Vault made by an earlier version keeps its Schema until the app brings it up to date.
  vault.map.upgradeSchema(loadSchemaFile(PATHS.schema));
  const app = createApp(vault, { runner: options.runner, vaultDir: options.vaultDir, version: VERSION, platform: process.platform });
  const web = options.web ?? PATHS.web;
  if (existsSync(web)) serveWeb(app, web);
  const open = await listen(app.fetch, options.port).catch((error: NodeJS.ErrnoException) => {
    if (options.anyPort && error.code === "EADDRINUSE") return listen(app.fetch, 0);
    throw error;
  });
  return {
    url: `http://127.0.0.1:${open.port}`,
    stop: () => new Promise((done) => open.server.close(() => done(vault.close()))),
  };
}
