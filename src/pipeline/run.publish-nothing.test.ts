import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HttpClient } from "../lib/http.js";
import { createLogger } from "../lib/log.js";
import { serializeEpisode } from "../publish/episode-json.js";
import { FakeLlm, type LlmError, type LlmRequest } from "../summarize/llm.js";
import { createFakeTtsAdapter } from "../tts/fake.js";
import type { TtsAdapter } from "../tts/tts.js";
import type { Result } from "../types.js";
import { runPipeline, type PipelineOutcome } from "./run.js";

const FIXTURE = readFileSync(join(process.cwd(), "content", "fixtures", "synthetic-3-items.xml"), "utf8");
const NOW = new Date("2026-11-20T17:00:00Z");

type Key = "buoy" | "sleep" | "birds";

/** Grounded lead sentences built only from names and numbers in each fixture article. */
const LEADS: Record<Key, string> = {
  buoy: "The Quartzfield Institute built a floating buoy that turns ocean waves into fresh drinking water.",
  sleep: "The Eastbrook Learning Lab followed 2,400 undergraduates and found regular sleepers remember more.",
  birds: "The Northgate Sound Library digitized 1,200 magnetic tapes of Arctic birdsong.",
};

const FILLER =
  "The team shares the results and keeps working on the project with partners and the public".split(" ");

/** A story of exactly `n` words: the lead, then lowercase filler (no names, numbers or dates). */
function story(lead: string, n: number): string {
  const words = lead.split(" ");
  let i = 0;
  while (words.length < n) words.push(FILLER[i++ % FILLER.length]!);
  const out = words.slice(0, n).join(" ");
  return out.endsWith(".") ? out : `${out}.`;
}

function keyOf(prompt: string): Key {
  if (prompt.includes("Quartzfield")) return "buoy";
  if (prompt.includes("Eastbrook")) return "sleep";
  return "birds";
}

/** Every story has the same length `n`, whatever the pass target. */
function makeLlm(n: number): FakeLlm {
  return new FakeLlm((req: LlmRequest) => ({ ok: true, value: story(LEADS[keyOf(req.prompt)], n) }));
}

function failingLlm(): FakeLlm {
  return new FakeLlm((): Result<string, LlmError> => ({ ok: false, error: { kind: "request-failed", message: "boom" } }));
}

function feedHttp(xml: string): HttpClient {
  return { request: async () => ({ ok: true, value: { status: 200, body: xml } }) };
}

const failingHttp: HttpClient = {
  request: async () => ({ ok: false, error: { kind: "network", message: "offline", attempts: 2 } }),
};

function bytesTts(bytes: Buffer): TtsAdapter {
  return { synthesize: async () => ({ ok: true, value: bytes }) };
}

const failingTts: TtsAdapter = {
  synthesize: async () => ({ ok: false, error: { kind: "request", message: "polly down", attempts: 2 } }),
};

describe("runPipeline publish-nothing: a failed build leaves the previous Episode byte-identical", () => {
  let root: string;
  let dir: string;
  let lockPath: string;
  let lines: Record<string, unknown>[];
  let jsonBefore: Buffer;
  let mp3Before: Buffer;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "run-publish-nothing-"));
    dir = join(root, "out");
    mkdirSync(dir);
    lockPath = join(root, "build.lock");
    lines = [];
    // Previous Episode with a different Selected_Set, so a rebuild is attempted.
    const previous = serializeEpisode({
      generatedFor: "2026-11-19",
      selectedItemIds: ["https://example.test/2026/older-story"],
      stories: [{ guid: "https://example.test/2026/older-story", title: "Older", script: "Older script." }],
    });
    writeFileSync(join(dir, "episode.json"), previous);
    writeFileSync(join(dir, "episode.mp3"), Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8]));
    jsonBefore = readFileSync(join(dir, "episode.json"));
    mp3Before = readFileSync(join(dir, "episode.mp3"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function run(http: HttpClient, llm: FakeLlm, tts: TtsAdapter): Promise<PipelineOutcome> {
    return runPipeline({
      http,
      llm,
      tts,
      clock: () => NOW,
      dir,
      lockPath,
      logger: createLogger({ write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) }),
    });
  }

  function expectUntouched(): void {
    expect(readdirSync(dir).sort()).toEqual(["episode.json", "episode.mp3"]);
    expect(readFileSync(join(dir, "episode.json")).equals(jsonBefore)).toBe(true);
    expect(readFileSync(join(dir, "episode.mp3")).equals(mp3Before)).toBe(true);
  }

  it("feed fetch failure", async () => {
    const llm = makeLlm(70);
    const outcome = await run(failingHttp, llm, createFakeTtsAdapter(61));
    expect(outcome).toMatchObject({ status: "failed", stage: "ingest" });
    expect(llm.calls).toHaveLength(0);
    expectUntouched();
  });

  it("all items dropped", async () => {
    const thinXml = FIXTURE.replace(
      /<content:encoded>[\s\S]*?<\/content:encoded>/g,
      "<content:encoded>&lt;p&gt;Too short.&lt;/p&gt;</content:encoded>",
    );
    expect(thinXml).not.toBe(FIXTURE);
    const llm = makeLlm(70);
    const outcome = await run(feedHttp(thinXml), llm, createFakeTtsAdapter(61));
    expect(outcome).toEqual({ status: "no-briefing", reason: "no-survivors" });
    expect(lines.filter((l) => l.event === "story-dropped" && l.reason === "too-thin")).toHaveLength(3);
    expect(llm.calls).toHaveLength(0);
    expectUntouched();
  });

  it("length floor (under 150 words) reports 'no new briefing today'", async () => {
    const outcome = await run(feedHttp(FIXTURE), makeLlm(20), createFakeTtsAdapter(61));
    expect(outcome).toEqual({ status: "no-briefing", reason: "script-too-short" });
    expect(lines.some((l) => l.event === "no-new-briefing" && l.reason === "script-too-short")).toBe(true);
    expectUntouched();
  });

  it("length ceiling exceeded", async () => {
    const outcome = await run(feedHttp(FIXTURE), makeLlm(100), createFakeTtsAdapter(61));
    expect(outcome).toEqual({ status: "no-briefing", reason: "length-exceeded" });
    expectUntouched();
  });

  it("TTS failure", async () => {
    const outcome = await run(feedHttp(FIXTURE), makeLlm(70), failingTts);
    expect(outcome).toMatchObject({ status: "failed", stage: "tts", reason: "request" });
    expectUntouched();
  });

  it("unmeasurable duration", async () => {
    const outcome = await run(feedHttp(FIXTURE), makeLlm(70), bytesTts(Buffer.alloc(2000, 0x41)));
    expect(outcome).toMatchObject({ status: "failed", stage: "tts", reason: "duration-unmeasurable" });
    expectUntouched();
  });

  it("duration under 60 seconds", async () => {
    const outcome = await run(feedHttp(FIXTURE), makeLlm(70), createFakeTtsAdapter(35));
    expect(outcome).toMatchObject({ status: "failed", stage: "tts", reason: "duration-below-minimum" });
    expectUntouched();
  });

  it("LLM failure", async () => {
    const llm = failingLlm();
    const outcome = await run(feedHttp(FIXTURE), llm, createFakeTtsAdapter(61));
    expect(outcome).toEqual({ status: "no-briefing", reason: "no-survivors" });
    expect(llm.calls).toHaveLength(3);
    expectUntouched();
  });
});
