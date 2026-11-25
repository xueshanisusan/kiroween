import { describe, expect, it } from "vitest";
import { isTooThin } from "./too-thin.js";

describe("isTooThin (Too_Thin_Threshold = 500)", () => {
  it("499 characters is too thin", () => {
    expect(isTooThin("a".repeat(499))).toBe(true);
  });
  it("500 characters is not too thin", () => {
    expect(isTooThin("a".repeat(500))).toBe(false);
  });
  it("501 characters is not too thin", () => {
    expect(isTooThin("a".repeat(501))).toBe(false);
  });
});
