import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILD_BUDGET_SECONDS,
  BUILD_LOCK_GRACE_SECONDS,
  CAMPUS_TIMEZONE,
  FEED_URLS,
  MIN_EPISODE_SECONDS,
  STORY_WORDS_PASS_1,
  STORY_WORDS_PASS_2_ONE_STORY,
  STORY_WORDS_PASS_2_TWO_STORIES,
  VOICE_ID,
} from "../config/index.js";
import { checkGrounding } from "../ground/ground.js";
import { fetchFeed } from "../ingest/ingest.js";
import { normalize } from "../ingest/normalize.js";
import { isAcceptableLength, wordCount } from "../length/length.js";
import type { HttpClient } from "../lib/http.js";
import type { Logger, Stage } from "../lib/log.js";
import { isTooThin } from "../select/too-thin.js";
import { select } from "../select/select.js";
import { summarize } from "../summarize/summarize.js";
import type { LlmAdapter } from "../summarize/llm.js";
import type { TtsAdapter } from "../tts/tts.js";
import type { FeedItem } from "../types.js";
import { assembleScript, buildIntro } from "../publish/assemble.js";
import { measureMp3DurationSeconds } from "../publish/duration.js";
import { type EpisodeJson, parseEpisode } from "../publish/episode-json.js";
import { generatedFor } from "../publish/generated-for.js";
import { EPISODE_JSON_FILE, publish } from "../publish/publish.js";
import { acquireLock, assertOwnsLock, isStale, readLock, reclaimStaleLock, releaseLock } from "./lock.js";

export type PipelineDeps = {
  http: HttpClient;
  llm: LlmAdapter;
  tts: TtsAdapter;
  /** Returns the current instant. The pipeline reads no other clock. */
  clock: () => Date;
  /** Directory holding the published Episode files. */
  dir: string;
  logger: Logger;
  lockPath: string;
  /** Defaults to the first configured feed URL. */
  feedUrl?: string;
  /**
   * Test seam: when set, this signal is the build deadline and no real timer is armed.
   * Production leaves it unset and gets a BUILD_BUDGET_SECONDS timer.
   */
  deadlineSignal?: AbortSignal;
};

export type PipelineOutcome =
  | { status: "published"; selectedItemIds: string[] }
  | { status: "unchanged" }
  | { status: "skipped-locked" }
  | { status: "no-briefing"; reason: string }
  | { status: "failed"; stage: Stage | "lock" | "deadline"; reason: string };

type Ctx = PipelineDeps & { signal: AbortSignal; buildId: string };

type Fail = Extract<PipelineOutcome, { status: "failed" }>;
type Drop = { guid: string; reason: "too-thin" | "grounding-failed" | "summarize-failed" };
type Survivor = { item: FeedItem; sourceText: string; script: string };

function weekdayOf(pubDate: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: CAMPUS_TIMEZONE, weekday: "long" }).format(new Date(pubDate));
}

function failed(ctx: Ctx, stage: Stage, startMs: number, code: string, fields: Record<string, unknown> = {}): Fail {
  ctx.logger.stageFailed(stage, ctx.clock().getTime() - startMs, code, fields);
  return { status: "failed", stage, reason: code };
}

function deadlineFail(ctx: Ctx): Fail {
  ctx.logger.info("deadline-exceeded", { budgetSeconds: BUILD_BUDGET_SECONDS });
  return { status: "failed", stage: "deadline", reason: "build-deadline-exceeded" };
}

function logNormalizeReport(logger: Logger, guid: string, r: ReturnType<typeof normalize>): void {
  const unknownTags = [...new Set(r.unknownTagNames)];
  if (unknownTags.length > 0) logger.info("unknown-tags", { guid, names: unknownTags });
  for (const u of r.unclosedElements) logger.info("unclosed-element", { guid, element: u.name, offset: u.offset });
  const entities = [...new Set(r.unrecognisedEntities)];
  if (entities.length > 0) logger.info("unrecognised-entities", { guid, names: entities });
  const numeric = [...new Set(r.invalidNumericRefs)];
  if (numeric.length > 0) logger.info("invalid-numeric-refs", { guid, refs: numeric });
}

/** Reads the stored Selected_Set. An absent Episode counts as empty; an invalid one is an error. */
function readStoredSet(dir: string): { ok: true; ids: string[] } | { ok: false; message: string } {
  let text: string;
  try {
    text = readFileSync(join(dir, EPISODE_JSON_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return { ok: true, ids: [] };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const parsed = parseEpisode(text);
  if (!parsed.ok) return { ok: false, message: `${parsed.error.field}: ${parsed.error.message}` };
  return { ok: true, ids: parsed.value.selectedItemIds };
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** Steps 2 to 15. The lock is already held. */
async function build(ctx: Ctx): Promise<PipelineOutcome> {
  const { logger, signal } = ctx;
  const now = ctx.clock();
  const nowMs = (): number => ctx.clock().getTime();

  // 2. ingest
  let t = nowMs();
  const feed = await fetchFeed(ctx.feedUrl ?? FEED_URLS[0], ctx.http);
  if (!feed.ok) return failed(ctx, "ingest", t, feed.error.kind, { message: feed.error.message });
  for (const s of feed.value.skipped) logger.info("item-skipped", { title: s.title, reason: s.reason });
  logger.stageOk("ingest", nowMs() - t, { items: feed.value.items.length });

  // 4. select (3. normalize runs per selected item below; it is pure and per-article)
  t = nowMs();
  const selection = select(feed.value.items, now, CAMPUS_TIMEZONE);
  const selectedIds = selection.selected.map((i) => i.guid);
  if (selection.selected.length === 0) {
    logger.stageOk("select", nowMs() - t, { selected: 0 });
    logger.info("no-new-briefing", { reason: "empty-selection" });
    return { status: "no-briefing", reason: "empty-selection" };
  }
  const stored = readStoredSet(ctx.dir);
  if (!stored.ok) return failed(ctx, "select", t, "stored-episode-unreadable", { message: stored.message });
  if (sameSet(stored.ids, selectedIds)) {
    logger.stageOk("select", nowMs() - t, { selected: selectedIds.length, changed: false });
    logger.info("selection-unchanged", { selectedItemIds: selectedIds });
    return { status: "unchanged" };
  }
  logger.stageOk("select", nowMs() - t, { selected: selectedIds.length, changed: true, widened: selection.widened });

  // 3 + 5. normalize each selected item, then drop too-thin ones
  const candidates: { item: FeedItem; sourceText: string }[] = [];
  const drops: Drop[] = [];
  for (const item of selection.selected) {
    const report = normalize(item.contentEncoded);
    logNormalizeReport(logger, item.guid, report);
    if (isTooThin(report.sourceText)) {
      drops.push({ guid: item.guid, reason: "too-thin" });
      logger.info("story-dropped", { guid: item.guid, reason: "too-thin" });
    } else {
      candidates.push({ item, sourceText: report.sourceText });
    }
  }

  // 6 to 8. summarize pass 1, ground, drop failures
  const pass = async (
    inputs: { item: FeedItem; sourceText: string }[],
    target: number,
  ): Promise<Survivor[] | Fail> => {
    const out: Survivor[] = [];
    for (const c of inputs) {
      const started = nowMs();
      const res = await summarize(c.sourceText, target, ctx.llm, signal);
      if (!res.ok) {
        if (signal.aborted) return deadlineFail(ctx);
        logger.info("story-dropped", { guid: c.item.guid, reason: "summarize-failed", message: res.error.message });
        continue;
      }
      const g = checkGrounding(res.value, c.sourceText, weekdayOf(c.item.pubDate));
      if (!g.passed) {
        logger.info("story-dropped", { guid: c.item.guid, reason: "grounding-failed", missing: g.missing });
        continue;
      }
      logger.stageOk("summarize", nowMs() - started, { guid: c.item.guid, targetWords: target });
      out.push({ item: c.item, sourceText: c.sourceText, script: res.value });
    }
    return out;
  };

  let survivors: Survivor[];
  const p1 = await pass(candidates, STORY_WORDS_PASS_1);
  if (!Array.isArray(p1)) return p1;
  survivors = p1;

  // 9 + 10. pass 2 only for 1 or 2 survivors, each grounded once
  if (survivors.length === 1 || survivors.length === 2) {
    const target = survivors.length === 1 ? STORY_WORDS_PASS_2_ONE_STORY : STORY_WORDS_PASS_2_TWO_STORIES;
    const p2 = await pass(survivors, target);
    if (!Array.isArray(p2)) return p2;
    survivors = p2;
  }
  if (signal.aborted) return deadlineFail(ctx);
  if (survivors.length === 0) {
    logger.info("no-new-briefing", { reason: "no-survivors" });
    return { status: "no-briefing", reason: "no-survivors" };
  }

  // 11 + 12. assemble and length check
  const count = survivors.length as 1 | 2 | 3;
  const intro = buildIntro({
    survivorCount: count,
    now,
    coveredDates: selection.widened ? selection.coveredDates : [],
  });
  const script = assembleScript(
    intro,
    survivors.map((s) => s.script),
  );
  const words = wordCount(script);
  if (!isAcceptableLength(words, count)) {
    const reason = words < 150 ? "script-too-short" : "length-exceeded";
    logger.info("no-new-briefing", { reason, words, storyCount: count });
    return { status: "no-briefing", reason };
  }

  // 13. synthesize
  t = nowMs();
  const audio = await ctx.tts.synthesize(script, VOICE_ID, signal);
  if (!audio.ok) {
    if (signal.aborted) return deadlineFail(ctx);
    return failed(ctx, "tts", t, audio.error.kind, { message: audio.error.message });
  }
  logger.stageOk("tts", nowMs() - t, { bytes: audio.value.length });

  // 14. measure duration
  const dur = measureMp3DurationSeconds(audio.value);
  if (!dur.ok) return failed(ctx, "tts", t, "duration-unmeasurable", { message: dur.error.message });
  logger.info("mp3-duration", { seconds: dur.value });
  if (dur.value < MIN_EPISODE_SECONDS) {
    return failed(ctx, "tts", t, "duration-below-minimum", { seconds: dur.value, minimum: MIN_EPISODE_SECONDS });
  }
  if (signal.aborted) return deadlineFail(ctx);

  // 15. publish
  t = nowMs();
  const episode: EpisodeJson = {
    generatedFor: generatedFor(now, CAMPUS_TIMEZONE),
    selectedItemIds: selectedIds,
    stories: survivors.map((s) => ({ guid: s.item.guid, title: s.item.title, script: s.script })),
  };
  const pub = await publish(episode, audio.value, ctx.dir, () => assertOwnsLock(ctx.lockPath, ctx.buildId));
  if (!pub.ok) return failed(ctx, "publish", t, pub.error.kind, { message: pub.error.message });
  logger.stageOk("publish", nowMs() - t, { selectedItemIds: selectedIds });
  return { status: "published", selectedItemIds: selectedIds };
}

/**
 * Runs one build: lock, stages, publish-nothing on any failure, build-end log line, unlock.
 * All dependencies are injected.
 */
export async function runPipeline(deps: PipelineDeps): Promise<PipelineOutcome> {
  const { logger, lockPath } = deps;
  const startedAtMs = deps.clock().getTime();

  // 1. acquire lock (reclaim if stale)
  let buildId: string;
  const acquired = acquireLock(lockPath, startedAtMs);
  if (acquired.ok) {
    buildId = acquired.value.buildId;
  } else if (acquired.error.kind === "held") {
    const existing = readLock(lockPath);
    if (!existing.ok || existing.value === null) {
      logger.info("build-skipped", { reason: "lock-unreadable" });
      return { status: "skipped-locked" };
    }
    if (!isStale(existing.value, startedAtMs, BUILD_BUDGET_SECONDS, BUILD_LOCK_GRACE_SECONDS)) {
      logger.info("build-skipped", { reason: "lock-held", heldBuildId: existing.value.buildId });
      return { status: "skipped-locked" };
    }
    const reclaimed = reclaimStaleLock(lockPath, existing.value, startedAtMs);
    if (!reclaimed.ok) {
      logger.info("build-skipped", { reason: "lock-reclaim-failed", error: reclaimed.error.kind });
      return { status: "skipped-locked" };
    }
    logger.info("lock-reclaimed", {
      oldBuildId: reclaimed.value.reclaimed.oldBuildId,
      ageMs: reclaimed.value.reclaimed.ageMs,
    });
    buildId = reclaimed.value.buildId;
  } else {
    logger.info("build-failed", { stage: "lock", message: ("message" in acquired.error ? acquired.error.message : acquired.error.kind) });
    return { status: "failed", stage: "lock", reason: ("message" in acquired.error ? acquired.error.message : acquired.error.kind) };
  }

  const controller = new AbortController();
  const timer = deps.deadlineSignal ? undefined : setTimeout(() => controller.abort(), BUILD_BUDGET_SECONDS * 1000);
  let outcome: PipelineOutcome;
  try {
    outcome = await build({ ...deps, signal: deps.deadlineSignal ?? controller.signal, buildId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.info("build-failed", { message });
    outcome = { status: "failed", stage: "publish", reason: message };
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 16. build-end log line, then release lock if still owned
  const buildDurationMs = deps.clock().getTime() - startedAtMs;
  logger.info("build-end", {
    buildDurationMs,
    exceededBudget: buildDurationMs > BUILD_BUDGET_SECONDS * 1000,
    status: outcome.status,
  });
  releaseLock(lockPath, buildId);
  return outcome;
}
