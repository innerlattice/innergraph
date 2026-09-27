import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR, COLOR_VARIABLE } from "./tokens";

const css = readFileSync(join(import.meta.dirname, "../index.css"), "utf8");
const themeValue = (variable: string) => css.match(new RegExp(`${variable}:\\s*([^;]+);`))?.[1];

describe("canvas tokens", () => {
  it("match the theme in index.css", () => {
    for (const [name, variable] of Object.entries(COLOR_VARIABLE)) expect([name, themeValue(variable)]).toEqual([name, COLOR[name as keyof typeof COLOR]]);
  });
});
