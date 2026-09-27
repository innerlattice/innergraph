// The desktop app: the same local server the CLI runs, in a window of its own. The Vault lives in
// the app's data folder (created on first run) and other agents reach it through this same binary
// running as plain Node, which is what Settings tells them to run.
import { join } from "node:path";
import { BrowserWindow, app, dialog, shell } from "electron";
import { desktopRunner } from "../src/clients/connect.js";
import { type LocalServer, startServer } from "../src/clients/server.js";
import { PATHS, ROOT } from "../src/paths.js";
import { initVault, openVault, vaultExists } from "../src/vault.js";

/** A fixed port keeps the page's origin, and so what it remembers, the same from run to run. */
const PORT = 43170;

let server: LocalServer | undefined;

function vault() {
  const dir = join(app.getPath("userData"), "vault");
  const open = vaultExists(dir) ? openVault({ dir }) : initVault({ dir, schemaFile: PATHS.schema });
  return { dir, open };
}

/** Links out of the app open in the person's browser, never in the app's window. */
function openOutside(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function createWindow(url: string): void {
  const window = new BrowserWindow({ width: 1440, height: 900, minWidth: 800, minHeight: 560, backgroundColor: "#f8f4ee", show: false, title: "Inner Graph" });
  window.webContents.setWindowOpenHandler(({ url: target }) => (openOutside(target), { action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (target.startsWith(url)) return;
    event.preventDefault();
    openOutside(target);
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(url);
}

async function start(): Promise<void> {
  const { dir, open } = vault();
  server = await startServer({ vault: open, vaultDir: dir, port: PORT, anyPort: true, runner: desktopRunner(process.execPath, ROOT) });
  const url = server.url;
  createWindow(url);
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow(url));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
  app.on("will-quit", () => void server?.stop());
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      dialog.showErrorBox("Inner Graph couldn't start", error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
}
