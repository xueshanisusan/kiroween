import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KIRO_CLI_BINARY,
  KIRO_CLI_NOT_LOGGED_IN_HINTS,
  KIRO_CLI_STDERR_EXCERPT_CHARS,
  KIRO_CLI_STDOUT_LIMIT_BYTES,
  KIRO_CLI_TIMEOUT_MS,
} from "./index.js";

describe("Kiro CLI config constants", () => {
  it("KIRO_CLI_BINARY is a non-empty string", () => {
    expect(typeof KIRO_CLI_BINARY).toBe("string");
    expect(KIRO_CLI_BINARY.length).toBeGreaterThan(0);
  });

  it("numeric limits are positive integers", () => {
    for (const n of [
      KIRO_CLI_TIMEOUT_MS,
      KIRO_CLI_STDOUT_LIMIT_BYTES,
      KIRO_CLI_STDERR_EXCERPT_CHARS,
    ]) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("KIRO_CLI_NOT_LOGGED_IN_HINTS is a non-empty array of lower-case strings", () => {
    expect(KIRO_CLI_NOT_LOGGED_IN_HINTS.length).toBeGreaterThan(0);
    for (const hint of KIRO_CLI_NOT_LOGGED_IN_HINTS) {
      expect(typeof hint).toBe("string");
      expect(hint.length).toBeGreaterThan(0);
      expect(hint).toBe(hint.toLowerCase());
    }
  });
});

describe("LLM_MODE default", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.LLM_MODE;
    delete process.env.LLM_MODE;
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_MODE;
    else process.env.LLM_MODE = saved;
    vi.resetModules();
  });

  it("defaults to 'http' when LLM_MODE is unset", async () => {
    const mod = await import("./index.js");
    expect(mod.LLM_MODE).toBe("http");
  });
});
