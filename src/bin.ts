#!/usr/bin/env node
import { runCli } from "./clients/cli.js";

const log = (message: string) => process.stderr.write(`${message}\n`);

runCli(process.argv.slice(2), { log }).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
