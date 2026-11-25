import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";
import type { FeedItem } from "../types.js";
import { select } from "./select.js";

const TZ = "America/New_York";
const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 10, 24, 12, 0, 0);

function localDate(ms: number): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// Offsets (hours before now; negative = future) mixing boundary values and random ones.
const offsetHours = fc.oneof(
  fc.constantFrom(-48, -1, 0, 1, 47, 48, 49, 167, 168, 169, 400),
  fc.integer({ min: -100, max: 400 }),
);

const itemArb = (nowMs: number) =>
  fc
    .record({
      guid: fc.constantFrom("a", "b", "c", "d", "e", "f"),
      off: offsetHours,
    })
    .map(
      ({ guid, off }): FeedItem => ({
        guid,
        title: `t-${guid}`,
        pubDate: new Date(nowMs - off * HOUR).toISOString(),
        contentEncoded: "",
      }),
    );

describe("Selector", () => {
  it("satisfies the selector invariants", () => {
    // Feature: briefing-pipeline, Property 9: Selector invariants
    // **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 14.4**
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }).chain((d) =>
          fc.tuple(
            fc.constant(BASE + d * HOUR),
            fc.array(itemArb(BASE + d * HOUR), { maxLength: 12 }),
          ),
        ),
        ([nowMs, items]) => {
          const res = select(items, new Date(nowMs), TZ);
          const t = (i: FeedItem) => Date.parse(i.pubDate);

          expect(res.selected.length).toBeLessThanOrEqual(3);
          for (const s of res.selected) {
            expect(t(s)).toBeLessThanOrEqual(nowMs);
            expect(nowMs - t(s)).toBeLessThanOrEqual(168 * HOUR);
          }
          for (let i = 1; i < res.selected.length; i++) {
            const a = res.selected[i - 1]!;
            const b = res.selected[i]!;
            expect(t(a)).toBeGreaterThanOrEqual(t(b));
            if (t(a) === t(b)) expect(a.guid <= b.guid).toBe(true);
          }

          const eligible = (w: number) =>
            items.filter((i) => t(i) <= nowMs && nowMs - t(i) <= w * HOUR);
          const narrow = eligible(48);
          const wide = eligible(168);

          if (narrow.length >= 3) {
            expect(res.widened).toBe(false);
            expect(res.coveredDates).toEqual([]);
            expect(res.selected).toHaveLength(3);
            for (const s of res.selected) expect(nowMs - t(s)).toBeLessThanOrEqual(48 * HOUR);
            // Selected are the three newest of the narrow window.
            const minSel = Math.min(...res.selected.map(t));
            expect(narrow.filter((i) => t(i) > minSel).length).toBeLessThanOrEqual(3);
          } else if (wide.length > 0) {
            expect(res.widened).toBe(true);
            expect(res.selected).toHaveLength(Math.min(3, wide.length));
            const expected = [...new Set(res.selected.map((s) => localDate(t(s))))].sort();
            expect([...res.coveredDates].sort()).toEqual(expected);
          } else {
            expect(res.selected).toEqual([]);
            expect(res.widened).toBe(false);
            expect(res.coveredDates).toEqual([]);
          }
          if (!res.widened) expect(res.coveredDates).toEqual([]);
        },
      ),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});
