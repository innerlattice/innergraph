// Behaviour fingerprint: a hash of the server and web app as they would run, bundled and
// tree-shaken, with every local binding renamed to its order of appearance (alpha-normalised).
// Renaming a variable, function, class or parameter, dropping an `export`, editing types or
// comments, and deleting code nothing reaches all leave the hash unchanged; property names and
// strings are kept, since callers can observe them. A refactor meant to be behaviour-neutral can
// prove it:
//
//   npm run fingerprint            # print the hashes
//   npm run fingerprint -- --save  # remember them in .fingerprint
//   npm run fingerprint -- --check # fail if they differ from .fingerprint
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import ts from "ts-api";

const ROOT = resolve(import.meta.dirname, "..");
const SAVED = resolve(ROOT, ".fingerprint");

const TARGETS = {
  server: { entryPoints: ["src/bin.ts"], platform: "node" as const, packages: "external" as const },
  web: { entryPoints: ["web/src/main.tsx"], platform: "browser" as const, jsx: "automatic" as const, loader: { ".css": "empty" as const } },
};

async function bundle(target: keyof typeof TARGETS): Promise<string> {
  const result = await build({ ...TARGETS[target], absWorkingDir: ROOT, bundle: true, format: "esm", write: false, logLevel: "error", legalComments: "none", define: { "import.meta.env.DEV": "false" } });
  return result.outputFiles.map((f) => f.text).join("\n");
}

const BINDINGS = ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Alias | ts.SymbolFlags.TypeParameter;

function isBinding(symbol: ts.Symbol | undefined, file: ts.SourceFile): symbol is ts.Symbol {
  if (!symbol || !(symbol.flags & BINDINGS) || symbol.flags & ts.SymbolFlags.Property) return false;
  return (symbol.declarations ?? []).every((d) => d.getSourceFile() === file);
}

/** The bundle with each local binding written as `$n`, n counting from its first appearance. */
export function normalise(code: string): string {
  const name = "bundle.js";
  const host = ts.createCompilerHost({ allowJs: true, noLib: true, noResolve: true });
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  host.getSourceFile = (f) => (f === name ? file : undefined);
  const checker = ts.createProgram([name], { allowJs: true, noLib: true, noResolve: true }, host).getTypeChecker();
  const ordinals = new Map<ts.Symbol, number>();
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent) ? undefined : checker.getSymbolAtLocation(node);
      if (isBinding(symbol, file)) {
        if (!ordinals.has(symbol)) ordinals.set(symbol, ordinals.size);
        edits.push({ start: node.getStart(), end: node.getEnd(), text: `$${ordinals.get(symbol)}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let out = "";
  let at = 0;
  for (const e of edits) (out += code.slice(at, e.start) + e.text), (at = e.end);
  return out + code.slice(at);
}

export async function fingerprints(): Promise<Record<string, string>> {
  const hash = async (target: keyof typeof TARGETS) => createHash("sha256").update(normalise(await bundle(target))).digest("hex").slice(0, 16);
  return { server: await hash("server"), web: await hash("web") };
}

async function main() {
  const current = await fingerprints();
  const mode = process.argv[2];
  if (mode === "--save") writeFileSync(SAVED, `${JSON.stringify(current, null, 2)}\n`);
  if (mode !== "--check") {
    for (const [k, v] of Object.entries(current)) console.log(`${k.padEnd(7)} ${v}`);
    return;
  }
  const saved = existsSync(SAVED) ? JSON.parse(readFileSync(SAVED, "utf8")) : {};
  const changed = Object.keys(current).filter((k) => saved[k] !== current[k]);
  for (const k of Object.keys(current)) console.log(`${k.padEnd(7)} ${saved[k] ?? "(none)"} → ${current[k]}${changed.includes(k) ? "  CHANGED" : ""}`);
  if (changed.length > 0) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
