import { describe, expect, it, vi } from "vitest";
import { ASSUMED_TTS_AUDIO_FORMAT } from "../config/tts-format.js";
import { measureMp3DurationSeconds } from "../publish/duration.js";
import { createFakeTtsAdapter } from "./fake.js";
import { buildPollyRequest, createEnvPollyClient, createPollyAdapter, type PollyClient, type PollySynthesizeRequest } from "./tts.js";

const signal = new AbortController().signal;

describe("Polly request builder", () => {
  it("pins neural engine, mp3 and sample rate", () => {
    const req = buildPollyRequest("hello", "Joanna");
    expect(req.Engine).toBe("neural");
    expect(req.OutputFormat).toBe("mp3");
    expect(req.SampleRate).toBe("24000");
    expect(req.SampleRate).toBe(String(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz));
  });

  it("every request sent to the client carries the pinned parameters, in one call", async () => {
    const seen: PollySynthesizeRequest[] = [];
    const client: PollyClient = {
      async synthesizeSpeech(req) {
        seen.push(req);
        return new Uint8Array([1, 2, 3]);
      },
    };
    const res = await createPollyAdapter(client).synthesize("hi", "Joanna", signal);
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ Engine: "neural", SampleRate: "24000", OutputFormat: "mp3", VoiceId: "Joanna" });
  });

  it("a changed constant changes the request", () => {
    const fmt = ASSUMED_TTS_AUDIO_FORMAT as { sampleRateHz: number };
    const original = fmt.sampleRateHz;
    try {
      fmt.sampleRateHz = 22050;
      expect(buildPollyRequest("x", "v").SampleRate).toBe("22050");
    } finally {
      fmt.sampleRateHz = original;
    }
  });
});

describe("Polly adapter failures", () => {
  it("retries once then returns a typed error", async () => {
    const synthesizeSpeech = vi.fn(async () => {
      throw new Error("boom");
    });
    const res = await createPollyAdapter({ synthesizeSpeech }).synthesize("hi", "v", signal);
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ ok: false, error: { kind: "request", message: "boom", attempts: 2 } });
  });

  it("succeeds when the retry succeeds", async () => {
    let n = 0;
    const client: PollyClient = {
      async synthesizeSpeech() {
        if (n++ === 0) throw new Error("transient");
        return new Uint8Array([9]);
      },
    };
    const res = await createPollyAdapter(client).synthesize("hi", "v", signal);
    expect(res.ok).toBe(true);
  });

  it("env client without credentials yields a typed error", async () => {
    const res = await createPollyAdapter(createEnvPollyClient({}), { retries: 0 }).synthesize("hi", "v", signal);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("request");
  });
});

describe("fake TTS adapter", () => {
  it("returns a measurable MP3 of about 35 seconds", async () => {
    const res = await createFakeTtsAdapter().synthesize("s", "v", signal);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const d = measureMp3DurationSeconds(res.value);
      expect(d.ok).toBe(true);
      if (d.ok) expect(Math.abs(d.value - 35)).toBeLessThan(1);
    }
  });
});
