// Bundles the desktop app's main process and the CLI it runs for other agents' MCP connections
// into build/. Dependencies stay in node_modules, where the installer puts them (and rebuilds the
// native SQLite module for Electron).
import { build } from "esbuild";

await build({
  entryPoints: { main: "desktop/main.ts", cli: "src/bin.ts" },
  outdir: "build",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
