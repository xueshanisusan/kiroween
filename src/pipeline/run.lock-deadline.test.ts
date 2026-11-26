import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILD_BUDGET_SECONDS, BUILD_LOCK_GRACE_SECONDS } from "../config/index.js";
import type { HttpClient } from "../lib/http.js";
import { createLogger } from "../lib/log.js";
import { FakeLlm } from "../summarize/llm.js";
import type { TtsAdapter } from "../tts/tts.js";
import { buildDefaultFakeTtsMp3 } from "../../test/helpers/mp3.js";
import { readLock } from "./lock.js";
import { runPipeline, type PipelineDeps } from "./run.js";

const FIXTURE = readFileSync(new URL("../../content/fixtures/synthetic-3-items.xml", import.meta.url), "utf8");
const NOW_MS = Date.parse("2026-11-20T18:00:00Z");
const STORY = "The" + " calm".repeat(64); // 65 words, no numbers or capitalized names

type Line = Record<string, unknown>;

let dir: string;
let lockPath: string;
let nowMs: number;
let lines: Line[];
let httpCalls: number;
let ttsCalls: number;

function harness(overrides: { llm?: FakeLlm; tts?: TtsAdapter; deadlineSignal?: AbortSignal } = {}) {
  const http: HttpClient = {
    async request() {
      httpCalls++;
      return { ok: true, value: { status: 200, body: FIXTURE } };
    },
  };
  const llm = overrides.llm ?? new FakeLlm(STORY);
  const tts: TtsAdapter =
    overrides.tts ??
    {
      async synthesize() {
        ttsCalls++;
        return { ok: true, value: buildDefaultFakeTtsMp3(70).bytes };
      },
    };
  const deps: PipelineDeps = {
    http,
    llm,
    tts,
    clock: () => new Date(nowMs),
    dir,
    lockPath,
    logger: createLogger({ briefingId: "test", write: (l) => lines.push(JSON.parse(l) as Line) }),
    deadlineSignal: overrides.deadlineSignal,
  };
  return { deps, llm };
}

const events = (name: string): Line[] => lines.filter((l) => l.event === name);
const episodeFiles = (): string[] => readdirSync(dir).filter((f) => f !== "build.lock");

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "run-lock-deadline-"));
  dir = join(root, "out");
  lockPath = join(root, "build.lock");
  mkdirSync(dir, { recursive: true });
  nowMs = NOW_MS;
  lines = [];
  httpCalls = 0;
  ttsCalls = 0;
});

afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

function writeForeignLock(ageSeconds: number, buildId = "other-build"): void {
  writeFileSync(lockPath, JSON.stringify({ pid: 1, startedAtMs: NOW_MS - ageSeconds * 1000, buildId }));
}

describe("runPipeline lock handling (11.9 to 11.12)", () => {
  it("skips the tick when the lock is held and fresh: no stage call, skip logged", async () => {

    writeForeignLock(10);
    const { deps, llm } = harness();
    const out = await runPipeline(deps);
    expect(out).toEqual({ status: "skipped-locked" });
    expect(httpCalls).toBe(0);
    expect(llm.calls).toHaveLength(0);
    expect(ttsCalls).toBe(0);
    expect(events("build-skipped")).toHaveLength(1);
    expect(events("build-skipped")[0]).toMatchObject({ reason: "lock-held", heldBuildId: "other-build" });
    expect(episodeFiles()).toEqual([]);
    const lock = readLock(lockPath);
    expect(lock.ok && lock.value?.buildId).toBe("other-build");
  });

  it("reclaims a stale lock, logs it, then builds and publishes", async () => {

    const ageSeconds = BUILD_BUDGET_SECONDS + BUILD_LOCK_GRACE_SECONDS + 5;
    writeForeignLock(ageSeconds);
    const { deps } = harness();
    const out = await runPipeline(deps);
    expect(out.status).toBe("published");
    const reclaimed = events("lock-reclaimed");
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ oldBuildId: "other-build", ageMs: ageSeconds * 1000 });
    expect(httpCalls).toBe(1);
    expect(episodeFiles().sort()).toEqual(["episode.json", "episode.mp3"]);
    expect(readLock(lockPath)).toEqual({ ok: true, value: null });
  });

  it("writes nothing when ownership is lost to a reclaim before publish", async () => {

    const tts: TtsAdapter = {
      async synthesize() {
        ttsCalls++;
        // another process reclaims the lock while this build is synthesizing
        writeForeignLock(0, "usurper");
        return { ok: true, value: buildDefaultFakeTtsMp3(70).bytes };
      },
    };
    const { deps } = harness({ tts });
    const out = await runPipeline(deps);
    expect(out).toMatchObject({ status: "failed", stage: "publish", reason: "lock-lost" });
    expect(episodeFiles()).toEqual([]);
    const lock = readLock(lockPath);
    expect(lock.ok && lock.value?.buildId).toBe("usurper");
    expect(events("build-end")).toHaveLength(1);
  });
});

describe("runPipeline deadline (11.9 to 11.12)", () => {
  const overBudgetMs = (BUILD_BUDGET_SECONDS + 1) * 1000;

  it("aborts mid-LLM: publishes nothing, logs exceededBudget", async () => {

    const controller = new AbortController();
    const llm = new FakeLlm(() => {
      nowMs += overBudgetMs;
      controller.abort();
      return { ok: false, error: { kind: "aborted", message: "aborted" } };
    });
    const { deps } = harness({ llm, deadlineSignal: controller.signal });
    const out = await runPipeline(deps);
    expect(out).toMatchObject({ status: "failed", stage: "deadline" });
    expect(llm.calls).toHaveLength(1);
    expect(ttsCalls).toBe(0);
    expect(episodeFiles()).toEqual([]);
    expect(events("deadline-exceeded")).toHaveLength(1);
    const end = events("build-end");
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ buildDurationMs: overBudgetMs, exceededBudget: true, status: "failed" });
    expect(readLock(lockPath)).toEqual({ ok: true, value: null });
  });

  it("aborts mid-TTS: publishes nothing, no partial file, logs exceededBudget", async () => {

    const controller = new AbortController();
    const tts: TtsAdapter = {
      async synthesize() {
        ttsCalls++;
        nowMs += overBudgetMs;
        controller.abort();
        return { ok: false, error: { kind: "aborted", message: "aborted", attempts: 1 } };
      },
    };
    const { deps, llm } = harness({ tts, deadlineSignal: controller.signal });
    const out = await runPipeline(deps);
    expect(out).toMatchObject({ status: "failed", stage: "deadline" });
    expect(llm.calls).toHaveLength(3);
    expect(ttsCalls).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
    const end = events("build-end");
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ exceededBudget: true, buildDurationMs: overBudgetMs });
  });

  it("logs buildDurationMs and exceededBudget=false on a normal build end", async () => {

    const { deps } = harness();
    const out = await runPipeline(deps);
    expect(out.status).toBe("published");
    const end = events("build-end");
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ buildDurationMs: 0, exceededBudget: false, status: "published" });
  });

  it("logs buildDurationMs and exceededBudget on a failed build end", async () => {

    const { deps } = harness({
      tts: {
        async synthesize() {
          nowMs += 1500;
          return { ok: false, error: { kind: "request", message: "boom", attempts: 3 } };
        },
      },
    });
    const out = await runPipeline(deps);
    expect(out).toMatchObject({ status: "failed", stage: "tts" });
    expect(events("build-end")[0]).toMatchObject({ buildDurationMs: 1500, exceededBudget: false, status: "failed" });
  });
});
