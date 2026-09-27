// Style audit: every colour, size and shadow must come from the design tokens (web/src/index.css
// @theme and web/src/design/). Flags, in the web app's source:
//   - Tailwind arbitrary values with a number in them (`text-[11px]`, `grid-cols-[14rem_1fr]`)
//   - lengths written out in strings (`"104px"`, `"2rem"`)
//   - colour literals (`#aa9c8a`, `rgb(…)`)
//   - Tailwind's own palette colours and shadows, which the theme clears
//   - numeric icon sizes (`size={14}`), which should use ICON
//   - `!important`, and Tailwind's `!` important modifier
// CSS files may define tokens inside @theme and @utility, but never use `!important`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "ts-api";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "web/src");
/** The token sources, where values are allowed. */
const TOKEN_DIR = join(WEB, "design");

export interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const TAILWIND_PALETTE = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"];
const COLOR_UTILITY = "(?:bg|text|border|border-[trblxy]|ring|ring-offset|outline|decoration|fill|stroke|from|via|to|accent|caret|divide|placeholder|shadow|inset-shadow)";

/** The colour families and shadow names the theme defines. */
export function themeTokens(css: string): { colors: Set<string>; shadows: Set<string> } {
  const colors = new Set([...css.matchAll(/--color-([a-z]+)(?:-\d+)?:/g)].map((m) => m[1]));
  const shadows = new Set([...css.matchAll(/--shadow-([a-z]+):/g)].map((m) => m[1]));
  return { colors, shadows };
}

type Rule = { rule: string; test: (text: string) => string | undefined };

function rules(theme: ReturnType<typeof themeTokens>): Rule[] {
  const foreign = TAILWIND_PALETTE.filter((c) => !theme.colors.has(c));
  const palette = new RegExp(`(?<![\\w-])${COLOR_UTILITY}-(?:${foreign.join("|")})-\\d+`);
  const shadow = /(?<![\w-])shadow-([a-z0-9]+)(?![\w-])/g;
  return [
    { rule: "arbitrary value", test: (t) => t.match(/[\w:/-]*-\[[^\]]*\d[^\]]*\]/)?.[0] },
    { rule: "hard-coded length", test: (t) => t.replace(/\[[^\]]*\]/g, "").match(/(?<![\w#-])\d*\.?\d+(?:px|rem|em|vh|vw|dvh|svh|lvh|vmin|vmax|ch|pt)(?![\w-])/)?.[0] },
    { rule: "colour literal", test: (t) => t.match(/#[0-9a-f]{3,8}(?![\w-])|\b(?:rgba?|hsla?|oklch)\(/i)?.[0] },
    { rule: "colour outside the theme", test: (t) => t.match(palette)?.[0] },
    { rule: "shadow outside the theme", test: (t) => [...t.matchAll(shadow)].find((m) => !theme.shadows.has(m[1]) && !theme.colors.has(m[1]))?.[0] },
    { rule: "!important", test: (t) => t.match(/!important|(?<=^|[\s:])![a-z][\w-]*|(?<=(?:^|\s)[\w:/.[\]-]*-[\w/.[\]]*)!(?=\s|$)/)?.[0] },
  ];
}

/** The text of every string and template literal in a source file, with its position. */
function strings(file: string, source: string): { text: string; pos: number }[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { text: string; pos: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) found.push({ text: node.text, pos: node.getStart() });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const lineOf = (source: string, pos: number) => source.slice(0, pos).split("\n").length;

export function auditSource(file: string, source: string, theme: ReturnType<typeof themeTokens>): Finding[] {
  const checks = rules(theme);
  const findings: Finding[] = [];
  for (const s of strings(file, source)) {
    for (const c of checks) {
      const text = c.test(s.text);
      if (text) findings.push({ file, line: lineOf(source, s.pos), rule: c.rule, text });
    }
  }
  for (const m of source.matchAll(/\bsize=\{\d[\d.]*\}/g)) findings.push({ file, line: lineOf(source, m.index), rule: "numeric icon size", text: m[0] });
  return findings;
}

export function auditCss(file: string, css: string): Finding[] {
  return [...css.matchAll(/!important/g)].map((m) => ({ file, line: lineOf(css, m.index), rule: "!important", text: m[0] }));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isAudited = (path: string) => /\.(tsx?|css)$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.startsWith(TOKEN_DIR);

export function auditWeb(): Finding[] {
  const theme = themeTokens(readFileSync(join(WEB, "index.css"), "utf8"));
  return walk(WEB)
    .filter(isAudited)
    .flatMap((path) => {
      const file = relative(ROOT, path);
      const text = readFileSync(path, "utf8");
      return path.endsWith(".css") ? auditCss(file, text) : auditSource(file, text, theme);
    });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const findings = auditWeb();
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}: ${f.text}`);
  console.log(findings.length === 0 ? "PASS: every style comes from the design tokens" : `FAIL: ${findings.length} hard-coded style${findings.length === 1 ? "" : "s"}`);
  process.exit(findings.length === 0 ? 0 : 1);
}
