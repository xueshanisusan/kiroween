import { describe, expect, it } from "vitest";
import { isAcceptableLength } from "./length.js";

describe("isAcceptableLength floor (150 words)", () => {
  for (const count of [1, 2, 3] as const) {
    it(`story count ${count}: 149 rejected, 150 and 151 accepted`, () => {
      expect(isAcceptableLength(149, count)).toBe(false);
      expect(isAcceptableLength(150, count)).toBe(true);
      expect(isAcceptableLength(151, count)).toBe(true);
    });
  }
});

describe("isAcceptableLength ceiling (budget)", () => {
  const budgets: Array<[1 | 2 | 3, number]> = [
    [3, 290],
    [2, 275],
    [1, 200],
  ];
  for (const [count, budget] of budgets) {
    it(`story count ${count}: ${budget} accepted, ${budget + 1} rejected`, () => {
      expect(isAcceptableLength(budget, count)).toBe(true);
      expect(isAcceptableLength(budget + 1, count)).toBe(false);
    });
  }
});
