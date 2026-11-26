import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAMPUS_TIMEZONE } from "../config/index.js";
import type { HttpClient } from "../lib/http.js";
import { createLogger } from "../lib/log.js";
import { generatedFor } from "../publish/generated-for.js";
import { parseEpisode } from "../publish/episode-json.js";
import { FakeLlm, type LlmRequest } from "../summarize/llm.js";
import { createFakeTtsAdapter } from "../tts/fake.js";
import type { TtsAdapter } from "../tts/tts.js";
import type { Result } from "../types.js";
import { runPipeline, type PipelineOutcome } from "./run.js";
import type { LlmError } from "../summarize/llm.js";

const FIXTURE = readFileSync(join(process.cwd(), "content", "fixtures", "synthetic-3-items.xml"), "utf8");
const NOW = new Date("2026-11-20T17:00:00Z");

const GUID_BUOY = "https://example.test/2026/tide-desalination-buoy-1116";
const GUID_SLEEP = "https://example.test/2026/sleep-schedules-student-memory-1118";
const GUID_BIRDS = "https://example.test/2026/arctic-birdsong-recordings-1120";

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
function story(lead: string, n: number, extra = ""): string {
  const words = [...lead.split(" "), ...(extra ? extra.split(" ") : [])];
  let i = 0;
  while (words.length < n) {
    words.push(FILLER[i % FILLER.length]!);
    i++;
  }
  const out = words.slice(0, n).join(" ");
  return out.endsWith(".") ? out : `${out}.`;
}

function keyOf(prompt: string): Key {
  if (prompt.includes("Quartzfield")) return "buoy";
  if (prompt.includes("Eastbrook")) return "sleep";
  return "birds";
}

function targetOf(prompt: string): number {
  return Number(/about (\d+) words/.exec(prompt)![1]);
}

/** Story length per target: keeps the totals inside the Length_Budget for each story count. */
const LEN: Record<number, number> = { 85: 70, 120: 100, 165: 125 };

type Override = (key: Key, target: number) => Result<string, LlmError> | undefined;

function makeLlm(override: Override = () => undefined): FakeLlm {
  return new FakeLlm((req: LlmRequest) => {
    const key = keyOf(req.prompt);
    const target = targetOf(req.prompt);
    return override(key, target) ?? { ok: true, value: story(LEADS[key], LEN[target]!) };
  });
}

const fail = (): Result<string, LlmError> => ({ ok: false, error: { kind: "request-failed", message: "boom" } });

function feedHttp(xml: string): HttpClient {
  return { request: async () => ({ ok: true, value: { status: 200, body: xml } }) };
}

function spyTts(seconds = 61): TtsAdapter & { scripts: string[] } {
  const inner = createFakeTtsAdapter(seconds);
  const scripts: string[] = [];
  return {
    scripts,
    synthesize: (script, voice, signal) => {
      scripts.push(script);
      return inner.synthesize(script, voice, signal);
    },
  };
}

describe("runPipeline full builds against synthetic-3-items.xml", () => {
  let root: string;
  let dir: string;
  let lockPath: string;
  let lines: Record<string, unknown>[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "run-full-build-"));
    dir = join(root, "out");
    mkdirSync(dir);
    lockPath = join(root, "build.lock");
    lines = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function run(llm: FakeLlm, tts: TtsAdapter, xml = FIXTURE): Promise<PipelineOutcome> {
    return runPipeline({
      http: feedHttp(xml),
      llm,
      tts,
      clock: () => NOW,
      dir,
      lockPath,
      logger: createLogger({ write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) }),
    });
  }

  const drops = (): Record<string, unknown>[] => lines.filter((l) => l.event === "story-dropped");
  const files = (): string[] => readdirSync(dir).sort();
  const episode = () => {
    const parsed = parseEpisode(readFileSync(join(dir, "episode.json"), "utf8"));
    if (!parsed.ok) throw new Error("episode.json invalid");
    return parsed.value;
  };

  it("3 survivors: one LLM call per item, no pass 2, one TTS call, MP3 then JSON published", async () => {
    const llm = makeLlm();
    const tts = spyTts();
    const outcome = await run(llm, tts);

    expect(outcome).toEqual({ status: "published", selectedItemIds: [GUID_BIRDS, GUID_SLEEP, GUID_BUOY] });
    expect(llm.calls).toHaveLength(3);
    for (const c of llm.calls) expect(targetOf(c.prompt)).toBe(85);
    expect(tts.scripts).toHaveLength(1);
    expect(tts.scripts[0]).not.toContain("short briefing today");
    expect(files()).toEqual(["episode.json", "episode.mp3"]);
    expect(statSync(join(dir, "episode.mp3")).mtimeMs).toBeLessThanOrEqual(statSync(join(dir, "episode.json")).mtimeMs);

    const ep = episode();
    expect(ep.generatedFor).toBe(generatedFor(NOW, CAMPUS_TIMEZONE));
    expect(ep.generatedFor).toBe("2026-11-20");
    expect(ep.selectedItemIds).toEqual([GUID_BIRDS, GUID_SLEEP, GUID_BUOY]);
    expect(ep.stories.map((s) => s.guid)).toEqual([GUID_BIRDS, GUID_SLEEP, GUID_BUOY]);
    expect(ep.stories[0]!.script).toBe(story(LEADS.birds, 70));
    expect(lines.some((l) => l.event === "build-end" && l.status === "published")).toBe(true);
  });

  it("2 survivors: pass 2 at 120 words, each survivor grounded once more, short-briefing intro", async () => {
    const llm = makeLlm((key) => (key === "buoy" ? fail() : undefined));
    const tts = spyTts();
    const outcome = await run(llm, tts);

    expect(outcome.status).toBe("published");
    expect(llm.calls.map((c) => targetOf(c.prompt))).toEqual([85, 85, 85, 120, 120]);
    const pass2 = lines.filter((l) => l.stage === "summarize" && l.targetWords === 120);
    expect(pass2.map((l) => l.guid)).toEqual([GUID_BIRDS, GUID_SLEEP]);
    expect(tts.scripts).toHaveLength(1);
    expect(tts.scripts[0]).toContain("short briefing today");
    expect(episode().stories[0]!.script).toBe(story(LEADS.birds, 100));
    expect(drops()).toEqual([expect.objectContaining({ guid: GUID_BUOY, reason: "summarize-failed" })]);
  });

  it("1 survivor: pass 2 at 165 words, short-briefing intro", async () => {
    const llm = makeLlm((key) => (key === "birds" ? undefined : fail()));
    const tts = spyTts();
    const outcome = await run(llm, tts);

    expect(outcome).toEqual({ status: "published", selectedItemIds: [GUID_BIRDS, GUID_SLEEP, GUID_BUOY] });
    expect(llm.calls.map((c) => targetOf(c.prompt))).toEqual([85, 85, 85, 165]);
    expect(tts.scripts[0]).toContain("short briefing today");
    const ep = episode();
    expect(ep.stories).toHaveLength(1);
    expect(ep.stories[0]!.guid).toBe(GUID_BIRDS);
    expect(ep.stories[0]!.script).toBe(story(LEADS.birds, 125));
  });

  it("0 survivors: nothing is published and TTS is not called", async () => {
    const llm = makeLlm(() => fail());
    const tts = spyTts();
    const outcome = await run(llm, tts);

    expect(outcome).toEqual({ status: "no-briefing", reason: "no-survivors" });
    expect(llm.calls).toHaveLength(3);
    expect(tts.scripts).toHaveLength(0);
    expect(files()).toEqual([]);
  });

  it("logs a too-thin drop with guid and reason", async () => {
    const thinXml = FIXTURE.replace(
      /<content:encoded>&lt;p&gt;A team of archivists[\s\S]*?<\/content:encoded>/,
      "<content:encoded>&lt;p&gt;A short note about birdsong tapes.&lt;/p&gt;</content:encoded>",
    );
    expect(thinXml).not.toBe(FIXTURE);
    const llm = makeLlm();
    const outcome = await run(llm, spyTts(), thinXml);

    expect(outcome.status).toBe("published");
    expect(drops()).toEqual([expect.objectContaining({ guid: GUID_BIRDS, reason: "too-thin" })]);
    expect(llm.calls.some((c) => c.prompt.includes("Northgate"))).toBe(false);
    expect(episode().stories.map((s) => s.guid)).toEqual([GUID_SLEEP, GUID_BUOY]);
  });

  it("logs a grounding-failed drop with guid, reason and the missing token", async () => {
    const llm = makeLlm((key, target) =>
      key === "birds" && target === 85
        ? { ok: true, value: story(LEADS.birds, 70, "Zanzibar") }
        : undefined,
    );
    const outcome = await run(llm, spyTts());

    expect(outcome.status).toBe("published");
    const d = drops();
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ guid: GUID_BIRDS, reason: "grounding-failed" });
    expect(JSON.stringify(d[0]!.missing)).toContain("Zanzibar");
    expect(episode().stories.map((s) => s.guid)).toEqual([GUID_SLEEP, GUID_BUOY]);
  });

  it("logs a summarize-failed drop with guid and reason", async () => {
    const llm = makeLlm((key) => (key === "sleep" ? fail() : undefined));
    const outcome = await run(llm, spyTts());

    expect(outcome.status).toBe("published");
    expect(drops()).toEqual([expect.objectContaining({ guid: GUID_SLEEP, reason: "summarize-failed" })]);
    expect(episode().stories.map((s) => s.guid)).toEqual([GUID_BIRDS, GUID_BUOY]);
  });
});
