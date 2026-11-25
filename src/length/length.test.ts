import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";
import { isAcceptableLength, wordCount } from "./length.js";

const BUDGETS = { 1: 200, 2: 275, 3: 290 } as const;

describe("isAcceptableLength", () => {
  // Feature: briefing-pipeline, Property 11: Length acceptance predicate matches the exact budget range
  it("accepts exactly 150..budget inclusive for story counts 1, 2, 3", () => {
    // **Validates: Requirements 8.4, 8.5, 8.8, 14.3**
    const anchors = [150, 200, 275, 290];
    const wordsArb = fc.oneof(
      fc.integer({ min: 0, max: 400 }),
      fc
        .tuple(fc.constantFrom(...anchors), fc.integer({ min: -3, max: 3 }))
        .map(([a, d]) => Math.max(0, a + d)),
    );
    fc.assert(
      fc.property(
        wordsArb,
        fc.constantFrom<1 | 2 | 3>(1, 2, 3),
        (words, count) => {
          expect(isAcceptableLength(words, count)).toBe(
            words >= 150 && words <= BUDGETS[count],
          );
        },
      ),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});

describe("wordCount additivity (Property 10 examples)", () => {
  it("wordCount(a + ' ' + b) === wordCount(a) + wordCount(b)", () => {
    // **Validates: Requirements 8.7**
    const pairs: [string, string][] = [
      ["one two", "three"],
      ["", "three four"],
      ["alpha", ""],
      ["  padded  text ", " more\twords\nhere"],
      ["", ""],
    ];
    for (const [a, b] of pairs) {
      expect(wordCount(`${a} ${b}`)).toBe(wordCount(a) + wordCount(b));
    }
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n\t")).toBe(0);
    expect(wordCount("a b  c")).toBe(3);
  });
});
