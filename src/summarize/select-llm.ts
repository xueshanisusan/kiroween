import { LLM_MODE } from "../config/index.js";
import { createHttpClient } from "../lib/http.js";
import type { Result } from "../types.js";
import { createKiroCliAdapter } from "./kiro-cli-adapter.js";
import { createEnvLlmAdapter, type LlmAdapter, type LlmError } from "./llm.js";

/**
 * The only place that chooses an LLM implementation. Unset or empty mode means 'http'.
 * An unknown value returns a typed "not-configured" error and constructs no adapter.
 * `factories` lets tests (and build-briefing, to reuse its HttpClient) inject adapters.
 */
export function selectLlmAdapter(
  mode: string | undefined = LLM_MODE,
  factories: { http?: () => LlmAdapter; kiroCli?: () => LlmAdapter } = {},
): Result<LlmAdapter, LlmError> {
  const name = (mode ?? "").trim().toLowerCase() || "http";
  if (name === "http") {
    return { ok: true, value: factories.http?.() ?? createEnvLlmAdapter(createHttpClient(), process.env) };
  }
  if (name === "kiro-cli") {
    return { ok: true, value: factories.kiroCli?.() ?? createKiroCliAdapter() };
  }
  return { ok: false, error: { kind: "not-configured", message: `unknown LLM_MODE '${name}'` } };
}
