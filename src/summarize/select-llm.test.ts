import { describe, expect, it, vi } from "vitest";
import type { LlmAdapter } from "./llm.js";
import { selectLlmAdapter } from "./select-llm.js";

function sentinel(): LlmAdapter {
  return { complete: vi.fn() } as unknown as LlmAdapter;
}

describe("selectLlmAdapter", () => {
  it.each<[string, string | undefined]>([
    ["'http'", "http"],
    ["empty string", ""],
    ["undefined", undefined],
  ])("returns the injected http adapter for %s", (_label, mode) => {
    const httpAdapter = sentinel();
    const http = vi.fn(() => httpAdapter);
    const kiroCli = vi.fn(() => sentinel());
    const result = selectLlmAdapter(mode, { http, kiroCli });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(httpAdapter);
    expect(http).toHaveBeenCalledTimes(1);
    expect(kiroCli).not.toHaveBeenCalled();
  });

  it("constructs the env http adapter by default without throwing", () => {
    expect(() => selectLlmAdapter("http")).not.toThrow();
    const result = selectLlmAdapter("http");
    expect(result.ok).toBe(true);
  });

  it("returns the injected kiro-cli adapter for 'kiro-cli'", () => {
    const cliAdapter = sentinel();
    const http = vi.fn(() => sentinel());
    const kiroCli = vi.fn(() => cliAdapter);
    const result = selectLlmAdapter("kiro-cli", { http, kiroCli });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(cliAdapter);
    expect(kiroCli).toHaveBeenCalledTimes(1);
    expect(http).not.toHaveBeenCalled();
  });

  it("returns not-configured for an unknown mode and calls neither factory", () => {
    const http = vi.fn(() => sentinel());
    const kiroCli = vi.fn(() => sentinel());
    const result = selectLlmAdapter("bogus", { http, kiroCli });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not-configured");
      expect(result.error.message).toContain("bogus");
    }
    expect(http).not.toHaveBeenCalled();
    expect(kiroCli).not.toHaveBeenCalled();
  });
});
