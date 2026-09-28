// Ships a version: every push goes out as one. `npm run ship -- patch|minor|major` checks the tree
// is clean and there is something new, runs the quality gate and the builds, bumps the version,
// writes the changelog from the commits since the last version, updates the version in the README,
// then commits, tags and pushes. The pre-push hook refuses pushes that skip this.
// Building the installers stays a separate, manual step (see README).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const KINDS = ["patch", "minor", "major"] as const;
type Kind = (typeof KINDS)[number];

export function bump(version: string, kind: Kind): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  return kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/** What went into a version: every commit since the last one, bar the release commits themselves. */
export function changes(subjects: string[]): string[] {
  return subjects.filter((s) => s.trim() && !/^Release v\d/.test(s));
}

export function section(version: string, date: string, subjects: string[]): string {
  return `## ${version} — ${date}\n\n${subjects.map((s) => `- ${s}`).join("\n")}\n`;
}

/** Puts the new version's section at the top, under the title. */
export function prepend(changelog: string, entry: string): string {
  const at = changelog.indexOf("\n## ");
  return at === -1 ? `${changelog.trimEnd()}\n\n${entry}` : `${changelog.slice(0, at + 1)}${entry}\n${changelog.slice(at + 1)}`;
}

/** The README names the current version between markers: <!-- version -->x.y.z<!-- /version -->. */
export function stampVersion(readme: string, version: string): string {
  return readme.replace(/<!-- version -->[^<]*<!-- \/version -->/g, `<!-- version -->${version}<!-- /version -->`);
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const run = (command: string, ...args: string[]) => execFileSync(command, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
const file = (name: string) => resolve(ROOT, name);

function fail(message: string): never {
  console.error(`ship: ${message}`);
  process.exit(1);
}

function pending(): { last: string; subjects: string[] } {
  if (git("status", "--porcelain")) fail("commit or stash your changes first.");
  const last = git("describe", "--tags", "--abbrev=0", "--match", "v*");
  const subjects = changes(git("log", "--format=%s", `${last}..HEAD`).split("\n"));
  if (subjects.length === 0) fail(`nothing new since ${last}.`);
  return { last, subjects };
}

function write(version: string, subjects: string[]): void {
  run("npm", "version", version, "--no-git-tag-version");
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(file("CHANGELOG.md"), prepend(readFileSync(file("CHANGELOG.md"), "utf8"), section(version, date, subjects)));
  writeFileSync(file("README.md"), stampVersion(readFileSync(file("README.md"), "utf8"), version));
}

function main(): void {
  const kind = process.argv[2] as Kind;
  if (!KINDS.includes(kind)) fail(`usage: npm run ship -- ${KINDS.join("|")} [--no-push]`);
  const { last, subjects } = pending();
  const docs = git("diff", "--name-only", `${last}..HEAD`, "--", "README.md", "docs", "skill");
  if (!docs) console.warn(`ship: README, docs and the skill are unchanged since ${last}; check they still describe the app.`);
  run("npm", "run", "quality");
  run("npm", "run", "build");
  run("npm", "run", "bundle");
  const current: string = JSON.parse(readFileSync(file("package.json"), "utf8")).version;
  const version = bump(current, kind);
  write(version, subjects);
  git("add", "package.json", "package-lock.json", "CHANGELOG.md", "README.md");
  git("commit", "-m", `Release v${version}`);
  git("tag", "-a", `v${version}`, "-m", `Inner Graph ${version}`);
  console.log(`ship: v${version}, with ${subjects.length} change${subjects.length === 1 ? "" : "s"}.`);
  if (process.argv.includes("--no-push")) console.log("ship: push with: git push --follow-tags");
  else run("git", "push", "--follow-tags");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
