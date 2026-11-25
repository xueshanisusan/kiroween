import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";
import { normalize, stripTags } from "./normalize.js";

const knownTag = fc
  .tuple(
    fc.constantFrom("p", "div", "br", "li", "h1", "b", "em", "a", "span", "code", "blockquote", "img", "P", "Div", "BR", "Em"),
    fc.boolean(),
    fc.constantFrom("", " class=\"x\"", " href='a>b'", " title=\"a<b>c\"", " /"),
  )
  .map(([n, closing, attrs]) => (closing ? `</${n}>` : `<${n}${attrs}>`));
const unknownTag = fc
  .tuple(fc.constantFrom("foo", "Bar9", "x1", "widget"), fc.constantFrom("", " a=\"1\"", " q='<>'"))
  .map(([n, a]) => `<${n}${a}>`);
const fragment = fc.oneof(
  { weight: 4, arbitrary: fc.string({ maxLength: 8 }).filter((s) => !s.includes("<")) },
  { weight: 3, arbitrary: knownTag },
  { weight: 2, arbitrary: unknownTag },
  { weight: 2, arbitrary: fc.constantFrom("<", "<<", "< ", "<3", "</", "<a href=\"x", "<b", "a > b") },
  { weight: 2, arbitrary: fc.constantFrom(" ", "  ", "\n\t", "\u00A0", " \u00A0 ", "\r\n") },
);
const input = fc.array(fragment, { maxLength: 12 }).map((a) => a.join(""));

const strip = (s: string) => s.replace(/ /g, "");
function isSubsequence(sub: string, full: string): boolean {
  let j = 0;
  for (let i = 0; i < full.length && j < sub.length; i++) if (full[i] === sub[j]) j++;
  return j === sub.length;
}
const count = (s: string, c: string) => s.split(c).length - 1;

describe("Tag_Stripper", () => {
  it("character provenance", () => {
    // Feature: briefing-pipeline, Property 1: Tag_Stripper character provenance
    // Validates: Requirements 2.1, 2.5, 2.10, 2.14, 14.7, 14.8
    fc.assert(
      fc.property(input, (s) => {
        const { text } = stripTags(s);
        // Output chars come from input in order, apart from inserted spaces for block tags.
        expect(isSubsequence(strip(text), strip(s))).toBe(true);
        // Any '<' remaining is a literal from the input; none is created.
        expect(count(text, "<")).toBeLessThanOrEqual(count(s, "<"));
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          ["<<b>b>"],
          ["<p>end.</p><p>Next</p>"],
        ],
      },
    );
    expect(stripTags("<<b>b>").text).toBe("<b>");
    expect(normalize("<p>end.</p><p>Next</p>").sourceText).toBe("end. Next");
  });
});
