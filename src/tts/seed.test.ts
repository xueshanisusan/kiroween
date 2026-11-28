import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FFMPEG_BINARY, HTTP_RETRY_COUNT, SEED_TTS_MODEL } from "../config/index.js";
import { ASSUMED_TTS_AUDIO_FORMAT } from "../config/tts-format.js";
import { createSeedAdapter, type SeedRequestOptions, type SeedSpeechRequest, type SpeechClient } from "./seed.js";
import type { ProcessRunner, ProcessSpec } from "./tts.js";

const KEY = "sk-or-test-secret-key";
const env = { OPENROUTER_API_KEY: KEY };
const live = new AbortController().signal;

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(Uint8Array.from(ch));
      c.close();
    },
  });
}

function httpError(statusCode: number): Error {
  return Object.assign(new Error(`body with ${KEY}`), { statusCode, name: "OpenRouterError" });
}

type Step = () => Promise<ReadableStream<Uint8Array>>;

function fakeClient(steps: Step[]) {
  const requests: SeedSpeechRequest[] = [];
  const options: (SeedRequestOptions | undefined)[] = [];
  const client: SpeechClient = {
    createSpeech(request, opts) {
      requests.push(request);
      options.push(opts);
      const step = steps[Math.min(requests.length - 1, steps.length - 1)] as Step;
      return step();
    },
  };
  return { client, requests, options };
}

function fakeRunner(code = 0) {
  const calls: ProcessSpec[] = [];
  const runner: ProcessRunner = {
    async run(spec) {
      calls.push(spec);
      if (code === 0) await writeFile(spec.args[spec.args.length - 1] as string, Buffer.from([9, 9, 9]));
      return { kind: "exited", code, stderr: "" };
    },
  };
  return { runner, calls };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "seed-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ok: Step = async () => streamOf([1, 2], [3], [4, 5]);

describe("Seed adapter request and result", () => {
  it("sends model, input, mp3 and no voice when none is configured; disables SDK retry", async () => {
    const { client, requests, options } = fakeClient([ok]);
    const { runner } = fakeRunner();
    await createSeedAdapter({ client, env, runner, tempRoot: root, voice: "" }).synthesize("hello", "piper-voice", live);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ speechRequest: { model: SEED_TTS_MODEL, input: "hello", responseFormat: "mp3" } });
    expect(requests[0]?.speechRequest).not.toHaveProperty("voice");
    expect(options[0]?.retries).toEqual({ strategy: "none" });
    expect(options[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends voice only when set, and ignores the Piper voice id argument", async () => {
    const { client, requests } = fakeClient([ok]);
    const { runner } = fakeRunner();
    await createSeedAdapter({ client, env, runner, tempRoot: root, voice: "spk-1", model: "m/x" }).synthesize("t", "en_US-ryan-high", live);
    expect(requests[0]).toEqual({ speechRequest: { model: "m/x", input: "t", voice: "spk-1", responseFormat: "mp3" } });
  });

  it("collects a multi-chunk stream into one buffer and encodes it once with the pinned arguments", async () => {
    const { client } = fakeClient([ok]);
    const { runner, calls } = fakeRunner();
    const res = await createSeedAdapter({ client, env, runner, tempRoot: root }).synthesize("t", "v", live);
    expect(res).toEqual({ ok: true, value: Buffer.from([9, 9, 9]) });
    expect(calls).toHaveLength(1);
    const a = (calls[0] as ProcessSpec).args;
    expect((calls[0] as ProcessSpec).command).toBe(FFMPEG_BINARY);
    expect(a).not.toContain("-af");
    expect(a[a.indexOf("-ar") + 1]).toBe(String(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz));
    expect(a[a.indexOf("-ac") + 1]).toBe("1");
    expect(a[a.indexOf("-c:a") + 1]).toBe("libmp3lame");
    expect(a[a.indexOf("-b:a") + 1]).toBe("48k");
    expect(await readdir(root)).toEqual([]);
  });

  it("adds -af when a filter is configured", async () => {
    const { client } = fakeClient([ok]);
    const { runner, calls } = fakeRunner();
    await createSeedAdapter({ client, env, runner, tempRoot: root, filter: "volume=2" }).synthesize("t", "v", live);
    const a = (calls[0] as ProcessSpec).args;
    expect(a[a.indexOf("-af") + 1]).toBe("volume=2");
  });
});

describe("Seed adapter error mapping and retries", () => {
  const cases: [number, string, boolean][] = [
    [400, "http-status", false],
    [401, "unauthorized", false],
    [402, "insufficient-credits", false],
    [403, "http-status", false],
    [404, "http-status", false],
    [429, "rate-limited", true],
    [500, "server-error", true],
    [502, "server-error", true],
  ];
  for (const [status, kind, retried] of cases) {
    it(`status ${status} gives ${kind}${retried ? " and is retried" : " and is not retried"}`, async () => {
      const { client, requests } = fakeClient([async () => Promise.reject(httpError(status))]);
      const { runner } = fakeRunner();
      const res = await createSeedAdapter({ client, env, runner, tempRoot: root }).synthesize("t", "v", live);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe(kind);
        expect(res.error.message).toContain(String(status));
        expect(res.error.message).not.toContain(KEY);
      }
      expect(requests).toHaveLength(retried ? 1 + HTTP_RETRY_COUNT : 1);
    });
  }

  it("succeeds when the retry after a 429 succeeds", async () => {
    const { client, requests } = fakeClient([async () => Promise.reject(httpError(429)), ok]);
    const { runner } = fakeRunner();
    const res = await createSeedAdapter({ client, env, runner, tempRoot: root }).synthesize("t", "v", live);
    expect(res.ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it("maps SDK error names structurally", async () => {
    const named = (name: string): Step => async () => Promise.reject(Object.assign(new Error("x"), { name }));
    const kindFor = async (name: string) => {
      const { client, requests } = fakeClient([named(name)]);
      const res = await createSeedAdapter({ client, env, runner: fakeRunner().runner, tempRoot: root }).synthesize("t", "v", live);
      return { kind: res.ok ? "ok" : res.error.kind, calls: requests.length };
    };
    expect(await kindFor("RequestTimeoutError")).toEqual({ kind: "timeout", calls: 1 + HTTP_RETRY_COUNT });
    expect(await kindFor("RequestAbortedError")).toEqual({ kind: "aborted", calls: 1 });
    expect(await kindFor("ConnectionError")).toEqual({ kind: "server-error", calls: 1 });
  });

  it("zero bytes gives empty-audio", async () => {
    const { client } = fakeClient([async () => streamOf()]);
    const res = await createSeedAdapter({ client, env, runner: fakeRunner().runner, tempRoot: root }).synthesize("t", "v", live);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("empty-audio");
  });

  it("a failed ffmpeg gives encode-failed and the request is not repeated", async () => {
    const { client, requests } = fakeClient([ok]);
    const res = await createSeedAdapter({ client, env, runner: fakeRunner(1).runner, tempRoot: root }).synthesize("t", "v", live);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("encode-failed");
    expect(requests).toHaveLength(1);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("Seed adapter timeout, abort and credentials", () => {
  it("times out with a never-resolving client and retries at most HTTP_RETRY_COUNT times", async () => {
    const { client, requests } = fakeClient([() => new Promise<ReadableStream<Uint8Array>>(() => undefined)]);
    const res = await createSeedAdapter({ client, env, runner: fakeRunner().runner, tempRoot: root, timeoutMs: 20 }).synthesize("t", "v", live);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("timeout");
      expect(res.error.attempts).toBe(1 + HTTP_RETRY_COUNT);
    }
    expect(requests).toHaveLength(1 + HTTP_RETRY_COUNT);
  });

  it("a stalled stream also times out", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start: () => undefined });
    const { client } = fakeClient([async () => stalled]);
    const res = await createSeedAdapter({ client, env, runner: fakeRunner().runner, tempRoot: root, timeoutMs: 20, retries: 0 }).synthesize("t", "v", live);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");
  });

  it("a build abort gives aborted without retry", async () => {
    const ctl = new AbortController();
    const { client, requests } = fakeClient([() => new Promise<ReadableStream<Uint8Array>>(() => undefined)]);
    const p = createSeedAdapter({ client, env, runner: fakeRunner().runner, tempRoot: root, timeoutMs: 5000 }).synthesize("t", "v", ctl.signal);
    setTimeout(() => ctl.abort(), 10);
    const res = await p;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("aborted");
    expect(requests).toHaveLength(1);
  });

  it("a missing or empty key gives missing-credentials and makes no call", async () => {
    for (const e of [{}, { OPENROUTER_API_KEY: "" }, { OPENROUTER_API_KEY: "  " }]) {
      const { client, requests } = fakeClient([ok]);
      const { runner, calls } = fakeRunner();
      const res = await createSeedAdapter({ client, env: e, runner, tempRoot: root }).synthesize("t", "v", live);
      expect(res).toEqual({ ok: false, error: { kind: "missing-credentials", message: "OPENROUTER_API_KEY is not set", attempts: 0 } });
      expect(requests).toHaveLength(0);
      expect(calls).toHaveLength(0);
    }
  });

  it("never puts the key in an error or in console output", async () => {
    const logged: string[] = [];
    const orig = [console.log, console.error, console.warn];
    console.log = console.error = console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      for (const status of [400, 401, 402, 429, 502]) {
        const { client } = fakeClient([async () => Promise.reject(httpError(status))]);
        const res = await createSeedAdapter({ client, env, runner: fakeRunner().runner, tempRoot: root }).synthesize("t", "v", live);
        expect(JSON.stringify(res)).not.toContain(KEY);
      }
    } finally {
      [console.log, console.error, console.warn] = orig as [typeof console.log, typeof console.error, typeof console.warn];
    }
    expect(logged.join("\n")).not.toContain(KEY);
  });
});
