import type { Result } from "../types.js";
import type { LlmAdapter } from "./llm.js";
import { buildPrompt } from "./prompt.js";

export type SummarizeError = { kind: "llm-failed" | "aborted"; message: string };

/**
 * Summarize one item: exactly one non-streaming LLM call. The caller passes the target
 * (85 in pass 1 for any story count; 120 or 165 in pass 2).
 */
export async function summarize(
  sourceText: string,
  targetWords: number,
  llm: LlmAdapter,
  signal: AbortSignal,
): Promise<Result<string, SummarizeError>> {
  if (signal.aborted) return { ok: false, error: { kind: "aborted", message: "aborted before LLM call" } };
  const res = await llm.complete({ prompt: buildPrompt(sourceText, targetWords), signal });
  if (!res.ok) {
    return { ok: false, error: { kind: res.error.kind === "aborted" ? "aborted" : "llm-failed", message: res.error.message } };
  }
  return { ok: true, value: res.value };
}
