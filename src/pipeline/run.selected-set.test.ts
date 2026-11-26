import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HttpClient } from "../lib/http.js";
import { createLogger } from "../lib/log.js";
import { EPISODE_JSON_FILE } from "../publish/publish.js";
import { FakeLlm } from "../summarize/llm.js";
import { createFakeTtsAdapter } from "../tts/fake.js";
import type { TtsAdapter } from "../tts/tts.js";
import { runPipeline } from "./run.js";

const FIXTURE = readFileSync(join(process.cwd(), "content", "fixtures", "synthetic-3-items.xml"), "utf8");
const NOW = new Date("2026-11-20T18:00:00Z");
const LATER_THAN_ALL_ITEMS = new Date("2026-12-10T18:00:00Z");

// About 60 words per story: three stories plus the intro land inside [150, 290].
const STORY =
  "The team built a device that works well in early tests and the group says the results look promising. " +
  "The next step is a longer trial that will show how the design holds up over time. " +
  "The researchers also want to learn what it would cost to make more of them for wider use by the public.";

function fakeHttp(body: string): HttpClient {
  return { request: async () => ({ ok: true, value: { status: 200, body } }) };
}

function countingTts(seconds: number): TtsAdapter & { calls: number } {
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

/** The fixture without its last item (Arctic birdsong). */
function twoItemFeed(): string {
  const start = FIXTURE.lastIndexOf("<item>");
  const end = FIXTURE.lastIndexOf("</item>") + "</item>".length;
  return FIXTURE.slice(0, start) + FIXTURE.slice(end);
}

describe("runPipeline Selected_Set comparison (Property 18)", () => {
  let root: string;
  let dir: string;
  let lockPath: string;
  let lines: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "selected-set-"));
    dir = join(root, "out");
    lockPath = join(root, "build.lock");
    mkdirSync(dir);
    lines = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(opts: { body?: string; now?: Date; llm: FakeLlm; tts: TtsAdapter }) {
    return runPipeline({
      http: fakeHttp(opts.body ?? FIXTURE),
      llm: opts.llm,
      tts: opts.tts,
      clock: () => opts.now ?? NOW,
      dir,
      lockPath,
      logger: createLogger({ briefingId: "test", write: (l) => lines.push(l) }),
    });
  }

  const episodeText = (): string => readFileSync(join(dir, EPISODE_JSON_FILE), "utf8");
  const logged = (event: string) => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((o) => o.event === event);

  it("no stored Episode counts as an empty set and triggers a full run", async () => {
    const llm = new FakeLlm(STORY);
    const tts = countingTts(70);
    const out = await run({ llm, tts });
    expect(out, lines.join("\n")).toMatchObject({ status: "published" });
    expect(llm.calls).toHaveLength(3);
    expect(tts.calls).toBe(1);
    expect(JSON.parse(episodeText()).selectedItemIds).toHaveLength(3);
  });

  it("equal sets: zero LLM calls, zero TTS calls, Episode unchanged", async () => {
    await run({ llm: new FakeLlm(STORY), tts: countingTts(70) });
    const before = episodeText();

    const llm = new FakeLlm(STORY);
    const tts = countingTts(70);
    const out = await run({ llm, tts });

    expect(out).toEqual({ status: "unchanged" });
    expect(llm.calls).toHaveLength(0);
    expect(tts.calls).toBe(0);
    expect(episodeText()).toBe(before);
    expect(logged("selection-unchanged")).toHaveLength(1);
  });

  it("different sets: full run replaces the Episode", async () => {
    await run({ body: twoItemFeed(), llm: new FakeLlm(STORY), tts: countingTts(70) });
    const before = episodeText();
    expect(JSON.parse(before).selectedItemIds).toHaveLength(2);

    const llm = new FakeLlm(STORY);
    const tts = countingTts(70);
    const out = await run({ llm, tts });

    expect(out.status).toBe("published");
    expect(llm.calls).toHaveLength(3);
    expect(tts.calls).toBe(1);
    expect(episodeText()).not.toBe(before);
    expect(JSON.parse(episodeText()).selectedItemIds).toHaveLength(3);
  });

  it("empty selection publishes nothing and logs the outcome", async () => {
    const llm = new FakeLlm(STORY);
    const tts = countingTts(70);
    const out = await run({ now: LATER_THAN_ALL_ITEMS, llm, tts });

    expect(out).toEqual({ status: "no-briefing", reason: "empty-selection" });
    expect(llm.calls).toHaveLength(0);
    expect(tts.calls).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
    expect(logged("no-new-briefing")).toEqual([
      expect.objectContaining({ reason: "empty-selection" }),
    ]);
  });
});
