// Validates: Requirements 2.7, 12.5
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS, WEB_CONFIG } from "../config/index.js";

import type { EpisodeJson } from "../publish/episode-json.js";
import { escapeHtml, renderPage, type PageText } from "./render.js";

const PAGE_TEXT: PageText = {
  outletName: WEB_CONFIG.outletName,
  pageTitle: WEB_CONFIG.pageTitle,
  emptyStateMessage: WEB_CONFIG.emptyStateMessage,
  audioLabel: WEB_CONFIG.audioLabel,
};

// Strings biased toward markup characters and literal script tags.
const hostileStringArb = fc
  .array(
    fc.oneof(
      fc.constantFrom("<", ">", "&", '"', "'", "<script>", "</script>", "<script>alert(1)</script>", "&amp;", "<b>"),
      fc.string({ maxLength: 8 }),
    ),
    { maxLength: 8 },
  )
  .map((parts) => parts.join(""));

const episodeArb: fc.Arbitrary<EpisodeJson> = fc.record({
  generatedFor: hostileStringArb,
  selectedItemIds: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
  stories: fc.array(
    fc.record({ guid: fc.string({ maxLength: 8 }), title: hostileStringArb, script: hostileStringArb }),
    { maxLength: 4 },
  ),
});

const XSS = "<script>alert(1)</script>";

describe("Page_Renderer escaping", () => {
  // Feature: web-player, Property 5: Rendered output escapes every Episode_JSON value
  it("escapes every Episode_JSON value in the rendered output", () => {
    fc.assert(
      fc.property(episodeArb, (episode) => {
        const html = renderPage({ kind: "published", episode }, PAGE_TEXT);

        expect(html.toLowerCase()).not.toContain("<script");
        expect(html).toContain(escapeHtml(episode.generatedFor));
        for (const story of episode.stories) {
          expect(html).toContain(escapeHtml(story.title));
          expect(html).toContain(escapeHtml(story.script));
        }

        // Removing the renderer's own tags (built from fixed text) leaves no field-originated '<'.
        const withoutFields = renderPage(
          { kind: "published", episode: { ...episode, generatedFor: "", stories: episode.stories.map((s) => ({ ...s, title: "", script: "" })) } },
          PAGE_TEXT,
        );
        expect(html.split("<").length).toBe(withoutFields.split("<").length);
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          [
            {
              generatedFor: XSS,
              selectedItemIds: [],
              stories: [{ guid: "g", title: XSS, script: XSS }],
            },
          ],
        ],
      },
    );
  });
});

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

const structureEpisodeArb: fc.Arbitrary<EpisodeJson> = fc.record({
  generatedFor: fc.string({ maxLength: 20 }),
  selectedItemIds: fc.array(fc.string({ maxLength: 8 }), { maxLength: 5 }),
  stories: fc.array(
    fc.record({
      guid: fc.string({ maxLength: 8 }),
      title: fc.oneof(fc.constant(""), hostileStringArb),
      script: fc.oneof(fc.constant(""), hostileStringArb),
    }),
    { minLength: 0, maxLength: 5 },
  ),
});

describe("Page_Renderer structure", () => {
  // Feature: web-player, Property 6: Rendered output has fixed structural shape
  it("has one h1, one audio element and one h2 per story when published, and no audio when empty", () => {
    fc.assert(
      fc.property(structureEpisodeArb, (episode) => {
        const published = renderPage({ kind: "published", episode }, PAGE_TEXT);
        expect(countOf(published, "<h1")).toBe(1);
        expect(countOf(published, "<audio controls")).toBe(1);
        expect(countOf(published, "<h2")).toBe(episode.stories.length);

        const empty = renderPage({ kind: "empty" }, PAGE_TEXT);
        expect(countOf(empty, "<h1")).toBe(1);
        expect(countOf(empty, "<audio")).toBe(0);
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});
