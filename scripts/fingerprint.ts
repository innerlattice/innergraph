// Behaviour fingerprint: a hash of the server and web app as they would run, bundled and
// tree-shaken, with every local binding renamed to its order of appearance (alpha-normalised).
// Renaming a variable, function, class or parameter, dropping an `export`, editing types or
// comments, and deleting code nothing reaches all leave the hash unchanged; property names and
// strings are kept, since callers can observe them. A refactor meant to be behaviour-neutral can
// prove it:
//
//   npm run fingerprint            # print the hashes
//   npm run fingerprint -- --save  # remember them (and the normalised bundles) in .fingerprint/
//   npm run fingerprint -- --check # fail if they differ, showing the lines that changed
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import ts from "ts-api";

const ROOT = resolve(import.meta.dirname, "..");
const SAVED = resolve(ROOT, ".fingerprint");
const HASHES = resolve(SAVED, "hashes.json");

const TARGETS = {
  server: { entryPoints: ["src/bin.ts"], platform: "node" as const, packages: "external" as const },
  web: { entryPoints: ["web/src/main.tsx"], platform: "browser" as const, jsx: "automatic" as const, loader: { ".css": "empty" as const } },
};

async function bundle(target: keyof typeof TARGETS): Promise<string> {
  const result = await build({
    ...TARGETS[target],
    absWorkingDir: ROOT,
    bundle: true,
    format: "esm",
    write: false,
    logLevel: "error",
    legalComments: "none",
    define: { "import.meta.env.DEV": "false" },
  });
  return result.outputFiles.map((f) => f.text).join("\n");
}

// Imports keep their names: they name another package's exports.
const BINDINGS = ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.Class;

function isBinding(symbol: ts.Symbol | undefined, file: ts.SourceFile): symbol is ts.Symbol {
  if (!symbol || !(symbol.flags & BINDINGS) || symbol.flags & ts.SymbolFlags.Property) return false;
  return (symbol.declarations ?? []).every((d) => d.getSourceFile() === file);
}

function isScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isFunctionLike(node) ||
    ts.isClassLike(node) ||
    ts.isBlock(node) ||
    ts.isIterationStatement(node, false) ||
    ts.isCatchClause(node) ||
    ts.isCaseBlock(node)
  );
}

/** esbuild marks where each source module starts ("// src/core/budget.ts"). */
function moduleStarts(code: string): { at: number; path: string }[] {
  return [...code.matchAll(/^\/\/ (\S+\.[cm]?[jt]sx?)$/gm)].map((m) => ({ at: m.index, path: m[1] }));
}

/** The scope a binding belongs to: its enclosing block or function, or for top-level names the
 *  source module, so adding or removing a module doesn't renumber the others. */
function scopeOf(declaration: ts.Node, modules: { at: number; path: string }[]): { scope: unknown; prefix: string } {
  let scope = declaration.parent;
  while (!isScope(scope)) scope = scope.parent;
  let depth = 0;
  for (let n = scope.parent; n; n = n.parent) if (isScope(n)) depth++;
  if (!ts.isSourceFile(scope)) return { scope, prefix: String(depth + 1) };
  const path = modules.findLast((m) => m.at <= declaration.getStart())?.path ?? "";
  return { scope: path, prefix: path.replace(/\W+/g, "_") };
}

/** The bundle with each binding written as `$scope_n`: the scope that declares it (nesting depth,
 *  or source module at the top level) and its order of appearance there. Numbering per scope
 *  keeps a change local in the diff. */
export function normalise(code: string): string {
  const name = "bundle.js";
  const host = ts.createCompilerHost({ allowJs: true, noLib: true, noResolve: true });
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  host.getSourceFile = (f) => (f === name ? file : undefined);
  const checker = ts.createProgram([name], { allowJs: true, noLib: true, noResolve: true }, host).getTypeChecker();
  const names = new Map<ts.Symbol, string>();
  const counts = new Map<unknown, number>();
  const modules = moduleStarts(code);
  const nameOf = (symbol: ts.Symbol) => {
    const { scope, prefix } = scopeOf(symbol.declarations?.[0] ?? file, modules);
    const n = counts.get(scope) ?? 0;
    counts.set(scope, n + 1);
    names.set(symbol, `$${prefix}_${n}`);
    return names.get(symbol) as string;
  };
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      // `{ key }` names a key as well as a binding: keep the key, as `key: $n`.
      const shorthand =
        ts.isShorthandPropertyAssignment(node.parent) || (ts.isBindingElement(node.parent) && !node.parent.propertyName && ts.isObjectBindingPattern(node.parent.parent));
      const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
      if (isBinding(symbol, file)) {
        const name = names.get(symbol) ?? nameOf(symbol);
        edits.push({ start: node.getStart(), end: node.getEnd(), text: shorthand ? `${node.text}: ${name}` : name });
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

type Target = keyof typeof TARGETS;

async function normalisedBundles(): Promise<Record<Target, string>> {
  return { server: normalise(await bundle("server")), web: normalise(await bundle("web")) };
}

const hashOf = (code: string) => createHash("sha256").update(code).digest("hex").slice(0, 16);

/** One statement per line, so a diff points at what changed. */
const lines = (code: string) => code.replace(/;(?=\S)/g, ";\n");

function showDiff(target: Target, code: string) {
  const now = resolve(SAVED, `${target}.now.js`);
  writeFileSync(now, lines(code));
  try {
    execFileSync("git", ["diff", "--no-index", "--no-color", "-U1", resolve(SAVED, `${target}.js`), now], { stdio: "inherit" });
  } catch {
    // git diff exits 1 when the files differ
  }
}

async function main() {
  const bundles = await normalisedBundles();
  const current = { server: hashOf(bundles.server), web: hashOf(bundles.web) };
  const mode = process.argv[2];
  if (mode === "--save") {
    mkdirSync(SAVED, { recursive: true });
    writeFileSync(HASHES, `${JSON.stringify(current, null, 2)}\n`);
    for (const t of Object.keys(bundles) as Target[]) writeFileSync(resolve(SAVED, `${t}.js`), lines(bundles[t]));
  }
  if (mode !== "--check") {
    for (const [k, v] of Object.entries(current)) console.log(`${k.padEnd(7)} ${v}`);
    return;
  }
  const saved = existsSync(HASHES) ? JSON.parse(readFileSync(HASHES, "utf8")) : {};
  const changed = (Object.keys(current) as Target[]).filter((k) => saved[k] !== current[k]);
  for (const t of changed) showDiff(t, bundles[t]);
  for (const k of Object.keys(current) as Target[]) console.log(`${k.padEnd(7)} ${saved[k] ?? "(none)"} → ${current[k]}${changed.includes(k) ? "  CHANGED" : ""}`);
  if (changed.length > 0) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
