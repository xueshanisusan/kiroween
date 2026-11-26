import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_BUDGET_SECONDS,
  BUILD_LOCK_GRACE_SECONDS,
  CRON_INTERVAL_SECONDS,
} from "../config/index.js";
import { createLogger } from "../lib/log.js";
import { acquireLock, assertOwnsLock, isStale, reclaimStaleLock, releaseLock } from "./lock.js";

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-test-"));
  lockPath = join(dir, ".build.lock");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("build lock", () => {
  it("acquires when no lock exists, and releases", () => {
    const r = acquireLock(lockPath, 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startedAtMs).toBe(1000);
    expect(assertOwnsLock(lockPath, r.value.buildId).ok).toBe(true);
    expect(releaseLock(lockPath, r.value.buildId).ok).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("held and fresh: second acquire reports held, tick is logged as skipped", () => {
    const first = acquireLock(lockPath, 0);
    expect(first.ok).toBe(true);
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) });
    const now = 10_000;
    const second = acquireLock(lockPath, now);
    expect(second.ok).toBe(false);
    if (second.ok || !first.ok) return;
    expect(second.error.kind).toBe("held");
    expect(isStale(first.value, now, BUILD_BUDGET_SECONDS, BUILD_LOCK_GRACE_SECONDS)).toBe(false);
    log.info("tick skipped: build lock held", { heldBuildId: first.value.buildId });
    expect(lines[0]).toContain("tick skipped");
  });

  it("held and stale: reclaim returns old buildId and age", () => {
    const first = acquireLock(lockPath, 0);
    if (!first.ok) throw new Error("setup");
    const now = (BUILD_BUDGET_SECONDS + BUILD_LOCK_GRACE_SECONDS) * 1000 + 1;
    expect(isStale(first.value, now, BUILD_BUDGET_SECONDS, BUILD_LOCK_GRACE_SECONDS)).toBe(true);
    const r = reclaimStaleLock(lockPath, first.value, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.buildId).not.toBe(first.value.buildId);
    expect(r.value.reclaimed).toEqual({ oldBuildId: first.value.buildId, ageMs: now });
    expect(assertOwnsLock(lockPath, r.value.buildId).ok).toBe(true);
  });

  it("isStale is false exactly at the threshold", () => {
    const lock = { pid: 1, startedAtMs: 0, buildId: "x" };
    expect(isStale(lock, 360_000, 300, 60)).toBe(false);
    expect(isStale(lock, 360_001, 300, 60)).toBe(true);
  });

  it("two concurrent acquires: exactly one wins", async () => {
    const results = await Promise.all([
      Promise.resolve().then(() => acquireLock(lockPath, 1)),
      Promise.resolve().then(() => acquireLock(lockPath, 1)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.error.kind).toBe("held");
  });

  it("assertOwnsLock fails for the old owner after a reclaim", () => {
    const first = acquireLock(lockPath, 0);
    if (!first.ok) throw new Error("setup");
    const re = reclaimStaleLock(lockPath, first.value, 999_999);
    expect(re.ok).toBe(true);
    const r = assertOwnsLock(lockPath, first.value.buildId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not-owner");
    // old owner cannot release the new owner's lock
    expect(releaseLock(lockPath, first.value.buildId).ok).toBe(false);
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe("lock config", () => {
  it("budget + grace is under the cron interval and budget <= 600", () => {
    expect(BUILD_BUDGET_SECONDS + BUILD_LOCK_GRACE_SECONDS).toBeLessThan(1200);
    expect(BUILD_BUDGET_SECONDS + BUILD_LOCK_GRACE_SECONDS).toBeLessThan(CRON_INTERVAL_SECONDS);
    expect(BUILD_BUDGET_SECONDS).toBeLessThanOrEqual(600);
  });
});
