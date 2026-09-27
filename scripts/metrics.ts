// Code-quality gate: per-function CRAP and per-file Maintainability Index.
//
//   CRAP(f) = CC(f)^2 * (1 - coverage(f))^3 + CC(f)
//   MI(f)   = 171 - 5.2 ln(HalsteadVolume) - 0.23 CC - 16.2 ln(SLOC)
//   MI(file) = same formula over the file's per-function averages (escomplex convention)
//
// Coverage comes from istanbul's coverage-final.json (run `npm run coverage` first).
// Fails when median or mode CRAP exceeds 8, or any file's MI is 70 or below.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "ts-api";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_DIRS = ["src", "web/src"];
const CRAP_LIMIT = 8;
const MI_LIMIT = 70;

interface FileCoverage {
  statementMap: Record<string, { start: { line: number; column: number } }>;
  s: Record<string, number>;
}

export interface FunctionMetric {
  file: string;
  name: string;
  line: number;
  cc: number;
  sloc: number;
  volume: number;
  coverage: number;
  crap: number;
}

export interface FileMetric {
  file: string;
  functions: number;
  /** null for declaration-only files (no functions), where function-average MI is undefined. */
  mi: number | null;
}

const DECISION_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
]);

const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const OPERAND_KINDS = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

function isDecision(node: ts.Node): boolean {
  if (DECISION_KINDS.has(node.kind)) return true;
  return ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);
}

/** McCabe complexity of a function body, not descending into nested functions. */
export function cyclomatic(fn: ts.Node): number {
  let count = 1;
  const visit = (node: ts.Node): void => {
    if (node !== fn && isFunctionLike(node)) return;
    if (isDecision(node)) count++;
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return count;
}

export function halsteadVolume(text: string, jsx: boolean): number {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  const operators = new Map<string, number>();
  const operands = new Map<string, number>();
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const bucket = OPERAND_KINDS.has(kind) ? operands : operators;
    const key = OPERAND_KINDS.has(kind) ? scanner.getTokenText() : String(kind);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const total = [...operators.values(), ...operands.values()].reduce((a, b) => a + b, 0);
  const vocabulary = operators.size + operands.size;
  return total * Math.log2(Math.max(vocabulary, 2));
}

export function sloc(text: string): number {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//");
  }).length;
}

export function maintainability(volume: number, cc: number, lines: number): number {
  return 171 - 5.2 * Math.log(Math.max(volume, 1)) - 0.23 * cc - 16.2 * Math.log(Math.max(lines, 1));
}

export function crap(cc: number, coverage: number): number {
  return cc * cc * (1 - coverage) ** 3 + cc;
}

function functionName(fn: ts.FunctionLikeDeclaration, source: ts.SourceFile): string {
  if (fn.name) return fn.name.getText(source);
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText(source);
  return `<anonymous:${ts.SyntaxKind[fn.kind]}>`;
}

function statementCoverage(cov: FileCoverage | undefined, start: ts.LineAndCharacter, end: ts.LineAndCharacter): number {
  if (!cov) return 0;
  const inside = Object.entries(cov.statementMap).filter(([, loc]) => within(loc.start, start, end));
  if (inside.length === 0) return 1;
  return inside.filter(([id]) => (cov.s[id] ?? 0) > 0).length / inside.length;
}

function within(pos: { line: number; column: number }, start: ts.LineAndCharacter, end: ts.LineAndCharacter): boolean {
  const line = pos.line - 1;
  const afterStart = line > start.line || (line === start.line && pos.column >= start.character);
  const beforeEnd = line < end.line || (line === end.line && pos.column <= end.character);
  return afterStart && beforeEnd;
}

export function analyseFile(file: string, text: string, coverage?: FileCoverage): FunctionMetric[] {
  const jsx = file.endsWith(".tsx");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const metrics: FunctionMetric[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) metrics.push(measure(node, source, file, coverage));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return metrics;
}

function measure(fn: ts.FunctionLikeDeclaration, source: ts.SourceFile, file: string, coverage?: FileCoverage): FunctionMetric {
  const body = fn.getText(source);
  const start = source.getLineAndCharacterOfPosition(fn.getStart(source));
  const end = source.getLineAndCharacterOfPosition(fn.getEnd());
  const cc = cyclomatic(fn);
  const cov = statementCoverage(coverage, start, end);
  return {
    file,
    name: functionName(fn, source),
    line: start.line + 1,
    cc,
    sloc: sloc(body),
    volume: halsteadVolume(body, file.endsWith(".tsx")),
    coverage: cov,
    crap: crap(cc, cov),
  };
}

const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

export function fileMaintainability(file: string, fns: FunctionMetric[]): FileMetric {
  if (fns.length === 0) return { file, functions: 0, mi: null };
  const mi = maintainability(average(fns.map((f) => f.volume)), average(fns.map((f) => f.cc)), average(fns.map((f) => f.sloc)));
  return { file, functions: fns.length, mi };
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mode(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs.map((v) => Math.round(v * 100) / 100)) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(d|test)\.tsx?$/.test(name) ? [path] : [];
  });
}

function loadCoverage(): Record<string, FileCoverage> {
  const file = join(ROOT, "coverage", "coverage-final.json");
  if (!existsSync(file)) throw new Error("coverage/coverage-final.json missing: run `npm run coverage` first");
  return JSON.parse(readFileSync(file, "utf8"));
}

function report(): boolean {
  const coverage = loadCoverage();
  const files = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));
  const functions: FunctionMetric[] = [];
  const perFile: FileMetric[] = [];
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const rel = relative(ROOT, path);
    const fns = analyseFile(rel, text, coverage[path]);
    functions.push(...fns);
    perFile.push(fileMaintainability(rel, fns));
  }
  const craps = functions.map((f) => f.crap);
  const scored = perFile.flatMap((f) => (f.mi === null ? [] : [f.mi]));
  const summary = {
    functions: functions.length,
    crapMedian: median(craps),
    crapMode: mode(craps),
    crapMax: Math.max(...craps),
    crapOver8: functions.filter((f) => f.crap > CRAP_LIMIT).length,
    miMin: Math.min(...scored),
    miMean: average(scored),
    declarationOnlyFiles: perFile.length - scored.length,
  };
  writeFileSync(join(ROOT, "coverage", "metrics.json"), JSON.stringify({ summary, perFile, functions }, null, 2));
  print(summary, functions, perFile);
  return summary.crapMedian <= CRAP_LIMIT && summary.crapMode <= CRAP_LIMIT && summary.miMin > MI_LIMIT;
}

function print(summary: Record<string, number>, functions: FunctionMetric[], perFile: FileMetric[]): void {
  const worst = [...functions].sort((a, b) => b.crap - a.crap).slice(0, 10);
  console.log("Highest CRAP functions:");
  console.table(worst.map((f) => ({ fn: `${f.file}:${f.line} ${f.name}`, cc: f.cc, cov: f.coverage.toFixed(2), crap: f.crap.toFixed(2) })));
  console.log("Lowest MI files:");
  const scored = perFile.filter((f) => f.mi !== null) as { file: string; functions: number; mi: number }[];
  console.table(
    scored
      .sort((a, b) => a.mi - b.mi)
      .slice(0, 10)
      .map((f) => ({ file: f.file, fns: f.functions, mi: f.mi.toFixed(1) })),
  );
  const skipped = perFile.filter((f) => f.mi === null).map((f) => f.file);
  if (skipped.length > 0) console.log(`Declaration-only files (no MI): ${skipped.join(", ")}`);
  console.log(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v.toFixed(2))])));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const ok = report();
  console.log(ok ? `PASS: CRAP median/mode <= ${CRAP_LIMIT}, every file MI > ${MI_LIMIT}` : "FAIL: quality gate not met");
  process.exitCode = ok ? 0 : 1;
}
