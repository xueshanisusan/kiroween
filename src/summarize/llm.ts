import type { HttpClient } from "../lib/http.js";
import type { Result } from "../types.js";

export type LlmError =
  | { kind: "not-configured"; message: string }
  | { kind: "request-failed"; message: string }
  | { kind: "bad-response"; message: string }
  | { kind: "aborted"; message: string }
  | { kind: "binary-not-found"; message: string }
  | { kind: "not-logged-in"; message: string }
  | { kind: "non-zero-exit"; exitCode: number; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "empty-output"; message: string };

export type LlmRequest = { prompt: string; signal: AbortSignal };

/** One non-streaming completion call. Retries (HTTP_RETRY_COUNT) happen inside the adapter. */
export interface LlmAdapter {
  complete(req: LlmRequest): Promise<Result<string, LlmError>>;
}

/** Fake for tests: records every request, returns scripted replies or a fixed text. */
export class FakeLlm implements LlmAdapter {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly reply: string | ((req: LlmRequest) => Result<string, LlmError>) = "Fake story.") {}

  async complete(req: LlmRequest): Promise<Result<string, LlmError>> {
    this.calls.push(req);
    if (req.signal.aborted) return { ok: false, error: { kind: "aborted", message: "aborted" } };
    return typeof this.reply === "function" ? this.reply(req) : { ok: true, value: this.reply };
  }
}

/**
 * Real provider adapter: an OpenAI-compatible chat-completions endpoint called through
 * the shared HttpClient (which applies timeout and HTTP_RETRY_COUNT retries).
 * Env: LLM_API_KEY, LLM_API_URL, LLM_MODEL. Missing values give a typed "not-configured" error.
 */
export function createEnvLlmAdapter(
  http: HttpClient,
  env: Record<string, string | undefined> = process.env,
): LlmAdapter {
  return {
    async complete(req) {
      const apiKey = env.LLM_API_KEY;
      const url = env.LLM_API_URL;
      const model = env.LLM_MODEL;
      if (!apiKey || !url || !model) {
        return {
          ok: false,
          error: { kind: "not-configured", message: "LLM_API_KEY, LLM_API_URL and LLM_MODEL must be set" },
        };
      }
      const res = await http.request({
        url,
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: req.prompt }] }),
        signal: req.signal,
      });
      if (!res.ok) {
        const kind = res.error.kind === "aborted" ? "aborted" : "request-failed";
        return { ok: false, error: { kind, message: res.error.message } };
      }
      try {
        const parsed = JSON.parse(res.value.body) as { choices?: { message?: { content?: unknown } }[] };
        const content = parsed.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim().length > 0) return { ok: true, value: content.trim() };
      } catch {
        // fall through
      }
      return { ok: false, error: { kind: "bad-response", message: "no completion text in response" } };
    },
  };
}
