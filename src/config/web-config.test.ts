import { describe, it, expect } from "vitest";
import { WEB_CONFIG, WEB_DEFAULT_PORT } from "./index.js";

describe("WEB_CONFIG", () => {
  // Requirement 9.1
  it("has non-empty text fields", () => {
    for (const value of [
      WEB_CONFIG.outletName,
      WEB_CONFIG.pageTitle,
      WEB_CONFIG.emptyStateMessage,
      WEB_CONFIG.audioLabel,
    ]) {
      expect(typeof value).toBe("string");
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it("has positive integer timeouts and cache lifetime", () => {
    for (const value of [
      WEB_CONFIG.jsonCacheMaxAgeSeconds,
      WEB_CONFIG.headerTimeoutMs,
      WEB_CONFIG.idleTimeoutMs,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("has a default port that is an integer from 1 to 65535", () => {
    expect(Number.isInteger(WEB_DEFAULT_PORT)).toBe(true);
    expect(WEB_DEFAULT_PORT).toBeGreaterThanOrEqual(1);
    expect(WEB_DEFAULT_PORT).toBeLessThanOrEqual(65535);
  });

  // Requirements 3.1, 3.3
  it("states in plain English that no briefing has been published yet", () => {
    expect(WEB_CONFIG.emptyStateMessage.toLowerCase()).toContain("no briefing has been published yet");
  });
});
