import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";
import { checkGrounding } from "./ground.js";

// Invented words: not months, weekdays, stoplist or lexicon words, and none is a substring of another.
const NAME_POOL = [
  "Brantley", "Kestrel", "Ostrander", "Valmont", "Quillon", "Fenwick", "Harlow", "Tamsin",
  "Ravenna", "Dorsey", "Lindqvist", "Moreau", "Pellham", "Zorin", "Aldous", "Corvin",
];
// Spelled-out values above 31 so they never collide with date day numbers.
const SPELLED = ["forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "June", "July",
  "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PUB_WEEKDAY = "Sunday"; // never generated, so weekdays must come from the source
const FILLERS = ["said", "reported", "near", "The", "However", "still", "also", "now", "about"];

type Entity = { src: string; scr: string };
type CaseMode = "lower" | "upper" | "cap";

function applyCase(word: string, mode: CaseMode): string {
  if (mode === "lower") return word.toLowerCase();
  if (mode === "upper") return word.toUpperCase();
  return word;
}

const entitiesArb: fc.Arbitrary<Entity[]> = fc
  .record({
    numbers: fc.uniqueArray(fc.integer({ min: 1001, max: 99999 }), { maxLength: 4 }),
    numForms: fc.array(fc.constantFrom("comma", "currency", "ordinal"), { minLength: 4, maxLength: 4 }),
    spelled: fc.uniqueArray(fc.constantFrom(...SPELLED), { maxLength: 3 }),
    dates: fc.uniqueArray(
      fc.record({ m: fc.constantFrom(...MONTH_NAMES), d: fc.integer({ min: 1, max: 28 }) }),
      { maxLength: 3, selector: (x) => `${x.m}-${x.d}` },
    ),
    weekdays: fc.uniqueArray(fc.constantFrom(...WEEKDAY_NAMES), { maxLength: 2 }),
    nameWords: fc.shuffledSubarray(NAME_POOL, { minLength: 1, maxLength: 8 }),
    runSizes: fc.array(fc.integer({ min: 1, max: 2 }), { minLength: 8, maxLength: 8 }),
    cases: fc.array(fc.constantFrom<CaseMode>("lower", "upper", "cap"), { minLength: 8, maxLength: 8 }),
  })
  .map((g) => {
    const out: Entity[] = [];
    g.numbers.forEach((n, i) => {
      const comma = n.toLocaleString("en-US");
      const form = g.numForms[i];
      const s = form === "currency" ? `$${comma}` : form === "ordinal" ? `${n}th` : comma;
      out.push({ src: s, scr: s });
    });
    for (const w of g.spelled) out.push({ src: w, scr: w });
    for (const d of g.dates) out.push({ src: `${d.m} ${d.d}`, scr: `${d.m} ${d.d}` });
    for (const w of g.weekdays) out.push({ src: w, scr: w });
    let wi = 0;
    let ri = 0;
    while (wi < g.nameWords.length) {
      const words = g.nameWords.slice(wi, wi + g.runSizes[ri]!);
      const mode = g.cases[ri]!;
      out.push({ src: words.map((w) => applyCase(w, mode)).join(" "), scr: words.join(" ") });
      wi += words.length;
      ri++;
    }
    return out;
  });

describe("checkGrounding", () => {
  // Feature: briefing-pipeline, Property 13: Removing a grounded entity from the source causes grounding to fail
  it("passes for a script built from the source, and fails naming the entity once it is removed", () => {
    // **Validates: Requirements 5.11, 5.13, 5.14, 14.3**
    fc.assert(
      fc.property(
        entitiesArb,
        fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
        fc.array(fc.integer({ min: 0, max: FILLERS.length - 1 }), { minLength: 20, maxLength: 20 }),
        fc.nat(),
        (entities, include, fillerIdx, pick) => {
          const filler = (i: number) => FILLERS[fillerIdx[i % fillerIdx.length]!]!;
          const sourceOf = (list: Entity[]) =>
            list.map((e, i) => `${filler(i)} ${e.src}`).join(" ") + " today";

          let used = entities.map((_, i) => i).filter((i) => include[i % include.length]);
          if (used.length === 0) used = entities.map((_, i) => i);

          const source = sourceOf(entities);
          const script = used.map((i) => `${filler(i + 1)} ${entities[i]!.scr}`).join(" ") + " today";

          // Unmodified pair must pass.
          const before = checkGrounding(script, source, PUB_WEEKDAY);
          expect(before.missing).toEqual([]);
          expect(before.passed).toBe(true);

          // Remove the one occurrence of an entity the script relies on.
          const target = used[pick % used.length]!;
          const reduced = entities.filter((_, i) => i !== target);
          const after = checkGrounding(script, sourceOf(reduced), PUB_WEEKDAY);
          expect(after.passed).toBe(false);
          expect(after.missing).toContain(entities[target]!.scr);
        },
      ),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});
