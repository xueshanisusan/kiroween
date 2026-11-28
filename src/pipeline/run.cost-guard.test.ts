import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HTTP_RETRY_COUNT } from "../config/index.js";
import type { HttpClient } from "../lib/http.js";
import { createLogger } from "../lib/log.js";
import { serializeEpisode } from "../publish/episode-json.js";
import { EPISODE_JSON_FILE } from "../publish/publish.js";
import { FakeLlm } from "../summarize/llm.js";
import { createLocalTtsAdapter, type TtsAdapter } from "../tts/tts.js";
import { createCountingTtsAdapter, createThrowingLlmAdapter, createThrowingTtsAdapter } from "../../test/helpers/throwing-adapters.js";
import { runPipeline, type PipelineOutcome } from "./run.js";

const FIXTURE = readFileSync(join(process.cwd(), "content", "fixtures", "synthetic-3-items.xml"), "utf8");
const NOW = new Date("2026-11-20T18:00:00Z");
const LATER_THAN_ALL_ITEMS = new Date("2026-12-10T18:00:00Z");

// About 60 words: three stories plus intro and outro land inside [150, 290].
const STORY =
  "The team built a device that works well in early tests and the group says the results look promising. " +
  "The next step is a longer trial that will show how the design holds up over time. " +
  "The researchers also want to learn what it would cost to make more of them for wider use by the public.";
const LONG_STORY = `${STORY} ${STORY}`; // three of these exceed the 290-word budget
const SHORT_STORY = "The team built a device.";

function feedHttp(xml: string): HttpClient {
  return { request: async () => ({ ok: true, value: { status: 200, body: xml } }) };
}

describe("cost guards: TTS is called only for a changed, publishable Selected_Set (Requirements 17.2 to 17.8)", () => {
  let root: string;
  let dir: string;
  let lockPath: string;
  let jsonBefore: Buffer;
  let mp3Before: Buffer;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "run-cost-guard-"));
    dir = join(root, "out");
    mkdirSync(dir);
    lockPath = join(root, "build.lock");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function seedPreviousEpisode(): void {
    writeFileSync(
      join(dir, EPISODE_JSON_FILE),
      serializeEpisode({
        generatedFor: "2026-11-19",
        selectedItemIds: ["https://example.test/2026/older-story"],
        stories: [{ guid: "https://example.test/2026/older-story", title: "Older", script: "Older script." }],
      }),
    );
    writeFileSync(join(dir, "episode.mp3"), Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8]));
    jsonBefore = readFileSync(join(dir, EPISODE_JSON_FILE));
    mp3Before = readFileSync(join(dir, "episode.mp3"));
  }

  function expectPreviousUntouched(): void {
    expect(readdirSync(dir).sort()).toEqual([EPISODE_JSON_FILE, "episode.mp3"]);
    expect(readFileSync(join(dir, EPISODE_JSON_FILE)).equals(jsonBefore)).toBe(true);
    expect(readFileSync(join(dir, "episode.mp3")).equals(mp3Before)).toBe(true);
  }

  function run(opts: { xml?: string; now?: Date; llm: FakeLlm; tts: TtsAdapter }): Promise<PipelineOutcome> {
    return runPipeline({
      http: feedHttp(opts.xml ?? FIXTURE),
      llm: opts.llm,
      tts: opts.tts,
      clock: () => opts.now ?? NOW,
      dir,
      lockPath,
      logger: createLogger({ write: () => undefined }),
    });
  }

  it("a normal build makes exactly one TTS call", async () => {
    const tts = createCountingTtsAdapter(70);
    const out = await run({ llm: new FakeLlm(STORY), tts });
    expect(out.status).toBe("published");
    expect(tts.calls).toBe(1);
  });

  it("an equal Selected_Set makes zero TTS calls", async () => {
    const first = createCountingTtsAdapter(70);
    await run({ llm: new FakeLlm(STORY), tts: first });
    const second = createCountingTtsAdapter(70);
    const out = await run({ llm: new FakeLlm(STORY), tts: second });
    expect(out).toEqual({ status: "unchanged" });
    expect(second.calls).toBe(0);
  });

  it("an empty selection makes zero TTS calls and keeps the previous Episode", async () => {
    seedPreviousEpisode();
    const tts = createCountingTtsAdapter(70);
    const out = await run({ now: LATER_THAN_ALL_ITEMS, llm: new FakeLlm(STORY), tts });
    expect(out).toEqual({ status: "no-briefing", reason: "empty-selection" });
    expect(tts.calls).toBe(0);
    expectPreviousUntouched();
  });

  it("zero Survivors makes zero TTS calls and keeps the previous Episode", async () => {
    seedPreviousEpisode();
    const thinXml = FIXTURE.replace(
      /<content:encoded>[\s\S]*?<\/content:encoded>/g,
      "<content:encoded>&lt;p&gt;Too short.&lt;/p&gt;</content:encoded>",
    );
    expect(thinXml).not.toBe(FIXTURE);
    const tts = createCountingTtsAdapter(70);
    const out = await run({ xml: thinXml, llm: new FakeLlm(STORY), tts });
    expect(out).toEqual({ status: "no-briefing", reason: "no-survivors" });
    expect(tts.calls).toBe(0);
    expectPreviousUntouched();
  });

  it("a script under 150 words makes zero TTS calls and keeps the previous Episode", async () => {
    seedPreviousEpisode();
    const tts = createCountingTtsAdapter(70);
    const out = await run({ llm: new FakeLlm(SHORT_STORY), tts });
    expect(out).toEqual({ status: "no-briefing", reason: "script-too-short" });
    expect(tts.calls).toBe(0);
    expectPreviousUntouched();
  });

  it("a script over the Length_Budget makes zero TTS calls and keeps the previous Episode", async () => {
    seedPreviousEpisode();
    const tts = createCountingTtsAdapter(70);
    const out = await run({ llm: new FakeLlm(LONG_STORY), tts });
    expect(out).toEqual({ status: "no-briefing", reason: "length-exceeded" });
    expect(tts.calls).toBe(0);
    expectPreviousUntouched();
  });

  it("a failed first call gives at most HTTP_RETRY_COUNT further calls", async () => {
    seedPreviousEpisode();
    // Pipeline level: one synthesize call per build, and the failed build leaves the Episode alone.
    let pipelineCalls = 0;
    const failing: TtsAdapter = {
      async synthesize() {
        pipelineCalls += 1;
        return { ok: false, error: { kind: "request", message: "down", attempts: 1 + HTTP_RETRY_COUNT } };
      },
    };
    const out = await run({ llm: new FakeLlm(STORY), tts: failing });
    expect(out).toMatchObject({ status: "failed", stage: "tts" });
    expect(pipelineCalls).toBeLessThanOrEqual(1 + HTTP_RETRY_COUNT);
    expectPreviousUntouched();

    // Adapter level: the retries happen inside the adapter, bounded by HTTP_RETRY_COUNT.
    let runnerCalls = 0;
    const adapter = createLocalTtsAdapter({
      runner: {
        async run() {
          runnerCalls += 1;
          return { kind: "exited", code: 1, stderr: "boom" };
        },
      },
    });
    const res = await adapter.synthesize("Hello there.", "voice", new AbortController().signal);
    expect(res.ok).toBe(false);
    // The first Piper step fails each attempt, so one runner call equals one attempt.
    expect(runnerCalls).toBeLessThanOrEqual(1 + HTTP_RETRY_COUNT);
    expect(runnerCalls).toBe(1 + HTTP_RETRY_COUNT);
  });
});

describe("request-time: no TTS or LLM call when serving the published Episode (Requirements 17.7, 11.3)", () => {
  it("the throwing adapters throw when called", async () => {
    const signal = new AbortController().signal;
    await expect(createThrowingTtsAdapter().synthesize("x", "v", signal)).rejects.toThrow();
    await expect(createThrowingLlmAdapter().complete({ prompt: "x", signal })).rejects.toThrow();
  });

  // No Request_Handler exists in src/ yet (the web player and telephony handlers belong to their own
  // specs). When the web-player spec and the telephony spec add their handlers, build each one here
  // with createThrowingTtsAdapter() and createThrowingLlmAdapter() and a temp dir holding a published
  // episode.mp3 and episode.json, then assert it still serves both.
});
