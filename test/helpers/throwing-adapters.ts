import type { LlmAdapter } from "../../src/summarize/llm.js";
import { createFakeTtsAdapter } from "../../src/tts/fake.js";
import type { TtsAdapter } from "../../src/tts/tts.js";

/** A TtsAdapter that throws if anything calls it. Proves a code path makes no TTS call. */
export function createThrowingTtsAdapter(): TtsAdapter {
  return {
    async synthesize() {
      throw new Error("TTS adapter must not be called on this path");
    },
  };
}

/** An LlmAdapter that throws if anything calls it. Proves a code path makes no LLM call. */
export function createThrowingLlmAdapter(): LlmAdapter {
  return {
    async complete() {
      throw new Error("LLM adapter must not be called on this path");
    },
  };
}

/** Wraps the default fake MP3 adapter and counts every `synthesize` call. */
export function createCountingTtsAdapter(seconds = 35): TtsAdapter & { calls: number } {
  const inner = createFakeTtsAdapter(seconds);
  const tts = {
    calls: 0,
    async synthesize(...args: Parameters<TtsAdapter["synthesize"]>) {
      tts.calls += 1;
      return inner.synthesize(...args);
    },
  };
  return tts;
}
