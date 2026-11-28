import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";
import { formatRange, parseRange } from "./range.js";

type Case = {
  size: number;
  header: string;
  /** Requested end for closed ranges, else undefined. */
  requestedEnd?: number;
};

const sizeArb = fc.integer({ min: 1, max: 1_000_000 });

const caseArb: fc.Arbitrary<Case> = sizeArb.chain((size) =>
  fc.oneof(
    // Closed: start inside the file, end anywhere at or after start (may pass the end).
    fc
      .integer({ min: 0, max: size - 1 })
      .chain((start) =>
        fc.integer({ min: start, max: size + 5000 }).map((end) => ({
          size,
          header: `bytes=${start}-${end}`,
          requestedEnd: end,
        })),
      ),
    // Open-ended.
    fc
      .integer({ min: 0, max: size - 1 })
      .map((start) => ({ size, header: `bytes=${start}-` })),
    // Suffix: length may exceed the file.
    fc
      .integer({ min: 1, max: size + 5000 })
      .map((length) => ({ size, header: `bytes=-${length}` })),
  ),
);

describe("parseRange", () => {
  // Feature: web-player, Property 1: Satisfiable ranges are well-formed and clamped
  it("returns well-formed, clamped ranges for satisfiable headers", () => {
    // **Validates: Requirements 5.3, 5.4, 5.6, 12.3**
    fc.assert(
      fc.property(caseArb, ({ size, header, requestedEnd }) => {
        const result = parseRange(header, size);
        expect(result.kind).toBe("satisfiable");
        if (result.kind !== "satisfiable") return;
        expect(result.start).toBeGreaterThanOrEqual(0);
        expect(result.start).toBeLessThanOrEqual(result.end);
        expect(result.end).toBeLessThan(size);
        if (requestedEnd !== undefined && requestedEnd >= size) {
          expect(result.end).toBe(size - 1);
        }
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });

  // Feature: web-player, Property 2: Unsatisfiable and not-a-range classification
  it("classifies non-bytes, multi-range, invalid and out-of-file ranges", () => {
    // **Validates: Requirements 5.5, 5.7, 12.8**
    type Classified = { header: string | undefined; size: number; expected: "not-a-range" | "unsatisfiable" };
    const size0 = fc.integer({ min: 0, max: 1_000_000 });
    const num = fc.integer({ min: 0, max: 2_000_000 });
    const classifiedArb: fc.Arbitrary<Classified> = fc.oneof(
      // Not a bytes= range.
      fc
        .oneof(fc.constant(undefined), fc.string().filter((s) => !s.startsWith("bytes=")))
        .chain((header) => size0.map((size) => ({ header, size, expected: "not-a-range" as const }))),
      // Multi-range.
      fc
        .tuple(size0, num, num, num, num)
        .map(([size, a, b, c, d]) => ({
          header: `bytes=${a}-${b},${c}-${d}`,
          size,
          expected: "unsatisfiable" as const,
        })),
      // Invalid single ranges: non-numeric parts, start > end, zero suffix, bare dash, extra dashes.
      fc
        .tuple(size0, fc.integer({ min: 1, max: 2_000_000 }), fc.integer({ min: 0, max: 1_000_000 }))
        .chain(([size, hi, lo]) =>
          fc
            .constantFrom(
              `bytes=${hi + lo}-${lo > 0 ? lo - 1 : 0}x`,
              `bytes=${hi}-${hi - 1}`,
              `bytes=x${hi}-`,
              `bytes=${hi}-y`,
              `bytes=-0`,
              `bytes=-`,
              `bytes=`,
              `bytes=${hi}`,
              `bytes=${hi}-${lo}-${hi}`,
              `bytes=-${hi}x`,
            )
            .map((header) => ({ header, size, expected: "unsatisfiable" as const })),
        ),
      // start >= size (closed and open-ended), including size 0.
      fc
        .tuple(size0, fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.boolean())
        .map(([size, over, extra, open]) => {
          const start = size + over;
          return {
            header: open ? `bytes=${start}-` : `bytes=${start}-${start + extra}`,
            size,
            expected: "unsatisfiable" as const,
          };
        }),
    );
    fc.assert(
      fc.property(classifiedArb, ({ header, size, expected }) => {
        expect(parseRange(header, size).kind).toBe(expected);
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });

  // Feature: web-player, Property 3: Range response byte count matches the parsed range
  it("slices exactly end - start + 1 bytes for every satisfiable range", () => {
    // **Validates: Requirements 12.4**
    fc.assert(
      fc.property(caseArb, ({ size, header }) => {
        const result = parseRange(header, size);
        expect(result.kind).toBe("satisfiable");
        if (result.kind !== "satisfiable") return;
        const fixture = Buffer.alloc(size);
        const slice = fixture.subarray(result.start, result.end + 1);
        expect(slice.length).toBe(result.end - result.start + 1);
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });

  // Feature: web-player, Property 4: Range header round-trip
  it("parses a formatted range back to the same start and end", () => {
    // **Validates: Requirements 12.7**
    const roundTripArb = sizeArb.chain((size) =>
      fc
        .integer({ min: 0, max: size - 1 })
        .chain((start) =>
          fc.integer({ min: start, max: size - 1 }).map((end) => ({ size, start, end })),
        ),
    );
    fc.assert(
      fc.property(roundTripArb, ({ size, start, end }) => {
        expect(parseRange(formatRange({ start, end }), size)).toEqual({
          kind: "satisfiable",
          start,
          end,
        });
      }),
      { numRuns: PROPERTY_TEST_RUNS },
    );
  });
});
