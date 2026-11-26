// Validates: Requirements 10.7, 10.9, 14.4
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";

import { parseEpisode, serializeEpisode, type EpisodeJson } from "./episode-json.js";

const dateArb = fc
  .date({ min: new Date("1000-01-01T00:00:00Z"), max: new Date("9999-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const storyArb = fc.record({
  guid: fc.string({ unit: "binary" }),
  title: fc.string({ unit: "binary" }),
  script: fc.string({ unit: "binary" }),
});

const episodeArb: fc.Arbitrary<EpisodeJson> = fc.record({
  generatedFor: dateArb,
  selectedItemIds: fc.array(fc.string({ unit: "binary" }), { maxLength: 6 }),
  stories: fc.array(storyArb, { maxLength: 4 }),
});

describe("Episode_JSON codec", () => {
  // Feature: briefing-pipeline, Property 16: Episode_JSON round-trips through serialize and parse
  it("round-trips through serialize and parse", () => {
    fc.assert(
      fc.property(episodeArb, (episode) => {
        const parsed = parseEpisode(serializeEpisode(episode));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.value).toEqual(episode);
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});
