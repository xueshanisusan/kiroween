// Feature: kiro-cli-llm-mode, Property 6: The selector is total and deterministic over its mode input
// **Validates: Requirements 2.3, 2.4, 2.5, 2.6**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LlmAdapter } from "./llm.js";
import { selectLlmAdapter } from "./select-llm.js";

const httpSentinel: LlmAdapter = { complete: async () => ({ ok: true, value: "http" }) };
const kiroSentinel: LlmAdapter = { complete: async () => ({ ok: true, value: "kiro" }) };

function run(mode: string | undefined) {
  const calls = { http: 0, kiroCli: 0 };
  const result = selectLlmAdapter(mode, {
    http: () => {
      calls.http += 1;
      return httpSentinel;
    },
    kiroCli: () => {
      calls.kiroCli += 1;
      return kiroSentinel;
    },
  });
  return { result, calls };
}

function check(mode: string | undefined): void {
  const name = (mode ?? "").trim().toLowerCase() || "http";
  const { result, calls } = run(mode);
  if (name === "http") {
    expect(result).toEqual({ ok: true, value: httpSentinel });
    expect(result.ok && result.value).toBe(httpSentinel);
    expect(calls).toEqual({ http: 1, kiroCli: 0 });
  } else if (name === "kiro-cli") {
    expect(result.ok && result.value).toBe(kiroSentinel);
    expect(calls).toEqual({ http: 0, kiroCli: 1 });
  } else {
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not-configured");
      expect(result.error.message).toContain(name);
    }
    expect(calls).toEqual({ http: 0, kiroCli: 0 });
  }
  // Determinism: same input, same branch.
  const again = run(mode);
  expect(again.result).toEqual(result);
  expect(again.calls).toEqual(calls);
}

describe("selectLlmAdapter total case-split (Property 6)", () => {
  it.each([undefined, "", "http", "kiro-cli", "KIRO-CLI", " kiro-cli "])("handles example %j", (mode) => {
    check(mode);
  });

  it("branches correctly and deterministically for arbitrary strings", () => {
    fc.assert(fc.property(fc.string(), (mode) => check(mode)), { numRuns: 200 });
  });

  it("branches correctly for arbitrary casing and padding of valid modes", () => {
    const padded = fc
      .tuple(fc.constantFrom("http", "kiro-cli"), fc.boolean(), fc.constantFrom("", " ", "\t", "\n"))
      .map(([m, upper, pad]) => `${pad}${upper ? m.toUpperCase() : m}${pad}`);
    fc.assert(fc.property(padded, (mode) => check(mode)), { numRuns: 100 });
  });
});
