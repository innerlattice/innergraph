import { describe, expect, it } from "vitest";
import { auditCss, auditSource, auditWeb, themeTokens } from "../scripts/auditStyles.js";

const theme = themeTokens("@theme { --color-*: initial; --color-stone-50: #fff; --color-rose-50: #fff; --color-highlight: #fff; --shadow-raised: 0; --shadow-halo: 0; }");
const rulesIn = (source: string) => auditSource("a.tsx", source, theme).map((f) => `${f.rule}: ${f.text}`);

describe("the style audit", () => {
  it("reads the colours and shadows the theme defines", () => {
    expect([...theme.colors]).toEqual(["stone", "rose", "highlight"]);
    expect([...theme.shadows]).toEqual(["raised", "halo"]);
  });

  it("flags values that bypass the tokens", () => {
    expect(rulesIn(`<p className="text-[11px] xl:grid-cols-[14rem_1fr]" />`)).toEqual(["arbitrary value: text-[11px]"]);
    expect(rulesIn(`const w = "calc(100vw - 104px)";`)).toEqual(["hard-coded length: 100vw"]);
    expect(rulesIn(`const c = "#aa9c8a";`)).toEqual(["colour literal: #aa9c8a"]);
    expect(rulesIn(`<p className="text-sky-700 bg-rose-50" />`)).toEqual(["colour outside the theme: text-sky-700"]);
    expect(rulesIn(`<p className="shadow-2xl hover:shadow-raised" />`)).toEqual(["shadow outside the theme: shadow-2xl"]);
    expect(rulesIn(`<Plus size={14} />`)).toEqual(["numeric icon size: size={14}"]);
  });

  it("flags !important and Tailwind's important modifier, but not negation or exclamations", () => {
    expect(rulesIn(`<p className="!p-2" />`)).toEqual(["!important: !p-2"]);
    expect(rulesIn(`<p className="p-2! m-1" />`)).toEqual(["!important: !"]);
    expect(rulesIn(`const s = { color: "red !important" };`)).toEqual(["!important: !important"]);
    expect(rulesIn(`const on = !props.open; const t = "Saved!";`)).toEqual([]);
    expect(auditCss("a.css", "p { color: red !important; }")).toEqual([{ file: "a.css", line: 1, rule: "!important", text: "!important" }]);
  });

  it("reads inside template literals, including after an interpolation", () => {
    expect(rulesIn("const c = `p-2 ${on ? 'a' : 'b'} text-[10px]`;")).toEqual(["arbitrary value: text-[10px]"]);
    expect(rulesIn("const c = `w-[3px] ${x}`;")).toEqual(["arbitrary value: w-[3px]"]);
  });

  it("allows arbitrary values without numbers and lengths computed at runtime", () => {
    expect(rulesIn("<p className=\"has-[:focus-visible]:w-72 transition-[width,box-shadow] shadow-halo bg-highlight\" style={{ height: `${h}px` }} />")).toEqual([]);
  });

  it("passes on the app", () => {
    expect(auditWeb()).toEqual([]);
  });
});
