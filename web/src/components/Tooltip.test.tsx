import { expect, it } from "vitest";
import { placeTip } from "./Tooltip";

const view = { width: 400, height: 300 };
const tip = { width: 100, height: 30 };
const anchor = (left: number, top: number) => ({ left, top, bottom: top + 20, width: 20 });

it("centres a tip above its anchor", () => {
  expect(placeTip(anchor(190, 100), tip, view)).toEqual({ left: 150, top: 64 });
});

it("keeps a tip inside the window at either side", () => {
  expect(placeTip(anchor(0, 100), tip, view).left).toBe(8);
  expect(placeTip(anchor(390, 100), tip, view).left).toBe(292);
});

it("flips a tip below an anchor at the top of the window", () => {
  expect(placeTip(anchor(190, 10), tip, view).top).toBe(36);
});
