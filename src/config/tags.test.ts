import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "./index.js";
import { BLOCK_TAG_SET, KNOWN_TAG_SET } from "./tags.js";

describe("tag sets", () => {
  // Feature: briefing-pipeline, Property 8: Block_Tag_Set is a subset of Known_Tag_Set
  // **Validates: Requirements 2.16, 14.11**
  it("every Block_Tag_Set member is in Known_Tag_Set", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BLOCK_TAG_SET), (tag) => {
        expect(KNOWN_TAG_SET.has(tag)).toBe(true);
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});
