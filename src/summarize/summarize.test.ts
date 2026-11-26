import { describe, expect, it } from "vitest";
import { STORY_WORDS_PASS_1 } from "../config/index.js";
import type { HttpClient } from "../lib/http.js";
import { createEnvLlmAdapter, FakeLlm } from "./llm.js";
import { impactSentence, openingParagraphs } from "./prompt.js";
import { summarize } from "./summarize.js";

const SOURCE =
  "Researchers built a new battery. It stores more charge. The team is led by Ada Smith. " +
  "Other labs were also involved. The design could cut costs by 40 percent. A final note closes.";

describe("summarize", () => {
  it("prompt contains the opening and one impact sentence, not a whole-article request", async () => {
    const llm = new FakeLlm();
    await summarize(SOURCE, 85, llm, new AbortController().signal);
    expect(llm.calls).toHaveLength(1);
    const prompt = llm.calls[0]!.prompt;
    expect(prompt).toContain(openingParagraphs(SOURCE));
    expect(prompt).toContain("The design could cut costs by 40 percent.");
    expect(impactSentence(SOURCE)).toBe("The design could cut costs by 40 percent.");
    expect(prompt).not.toContain("Other labs were also involved.");
    expect(prompt).not.toMatch(/compress|summari[sz]e the (whole|entire)/i);
  });

  it("pass 1 uses target 85 for 1, 2 and 3 items", async () => {
    for (const items of [1, 2, 3]) {
      const llm = new FakeLlm();
      for (let i = 0; i < items; i++) {
        await summarize(SOURCE, STORY_WORDS_PASS_1, llm, new AbortController().signal);
      }
      expect(llm.calls).toHaveLength(items);
      for (const c of llm.calls) expect(c.prompt).toContain("about 85 words");
    }
  });

  it("returns the LLM text on success", async () => {
    const r = await summarize(SOURCE, 85, new FakeLlm("A story."), new AbortController().signal);
    expect(r).toEqual({ ok: true, value: "A story." });
  });

  it("maps an LLM failure to a typed error", async () => {
    const llm = new FakeLlm(() => ({ ok: false, error: { kind: "request-failed", message: "boom" } }));
    const r = await summarize(SOURCE, 85, llm, new AbortController().signal);
    expect(r).toEqual({ ok: false, error: { kind: "llm-failed", message: "boom" } });
  });

  it("propagates the abort signal to the adapter and stops when already aborted", async () => {
    const llm = new FakeLlm();
    const ac = new AbortController();
    await summarize(SOURCE, 85, llm, ac.signal);
    expect(llm.calls[0]!.signal).toBe(ac.signal);

    ac.abort();
    const r = await summarize(SOURCE, 85, llm, ac.signal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("aborted");
    expect(llm.calls).toHaveLength(1);
  });
});

describe("createEnvLlmAdapter", () => {
  const signal = new AbortController().signal;

  it("returns not-configured without credentials, making no request", async () => {
    let called = false;
    const http: HttpClient = { request: async () => ((called = true), { ok: true, value: { status: 200, body: "" } }) };
    const r = await createEnvLlmAdapter(http, {}).complete({ prompt: "p", signal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not-configured");
    expect(called).toBe(false);
  });

  it("posts a non-streaming request and parses the reply; http failure is typed", async () => {
    const env = { LLM_API_KEY: "k", LLM_API_URL: "https://llm.test/v1", LLM_MODEL: "m" };
    let sent: { body?: string; signal?: AbortSignal } = {};
    const ok: HttpClient = {
      request: async (req) => {
        sent = req;
        return { ok: true, value: { status: 200, body: JSON.stringify({ choices: [{ message: { content: " Hi. " } }] }) } };
      },
    };
    expect(await createEnvLlmAdapter(ok, env).complete({ prompt: "p", signal })).toEqual({ ok: true, value: "Hi." });
    expect(JSON.parse(sent.body!).stream).toBe(false);
    expect(sent.signal).toBe(signal);

    const bad: HttpClient = {
      request: async () => ({ ok: false, error: { kind: "status", status: 503, message: "HTTP 503", attempts: 2 } }),
    };
    const r = await createEnvLlmAdapter(bad, env).complete({ prompt: "p", signal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("request-failed");
  });
});
