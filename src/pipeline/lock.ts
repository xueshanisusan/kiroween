import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { Result } from "../types.js";

export type LockInfo = { pid: number; startedAtMs: number; buildId: string };

export type LockError =
  | { kind: "held" }
  | { kind: "not-owner" }
  | { kind: "io-error"; message: string };

/** Returned by reclaimStaleLock: the new lock plus what was reclaimed (for the log line, 11.12). */
export type ReclaimedLock = LockInfo & { reclaimed: { oldBuildId: string; ageMs: number } };

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

function ioError(e: unknown): { kind: "io-error"; message: string } {
  return { kind: "io-error", message: e instanceof Error ? e.message : String(e) };
}

function newLock(clockMs: number): LockInfo {
  return { pid: process.pid, startedAtMs: clockMs, buildId: randomUUID() };
}

/** Reads the lock file. `null` means no lock file exists. */
export function readLock(lockPath: string): Result<LockInfo | null, LockError> {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockInfo>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.startedAtMs !== "number" ||
      typeof parsed.buildId !== "string"
    ) {
      return { ok: false, error: { kind: "io-error", message: "malformed lock file" } };
    }
    return { ok: true, value: { pid: parsed.pid, startedAtMs: parsed.startedAtMs, buildId: parsed.buildId } };
  } catch (e) {
    if (errCode(e) === "ENOENT") return { ok: true, value: null };
    return { ok: false, error: ioError(e) };
  }
}

/** Exclusive-create the lock file. Returns `held` if it already exists. */
export function acquireLock(lockPath: string, clockMs: number): Result<LockInfo, LockError> {
  const info = newLock(clockMs);
  try {
    writeFileSync(lockPath, JSON.stringify(info), { flag: "wx" });
    return { ok: true, value: info };
  } catch (e) {
    if (errCode(e) === "EEXIST") return { ok: false, error: { kind: "held" } };
    return { ok: false, error: ioError(e) };
  }
}

/** Removes the lock only if it is still owned by `buildId`. */
export function releaseLock(lockPath: string, buildId: string): Result<void, LockError> {
  const owned = assertOwnsLock(lockPath, buildId);
  if (!owned.ok) return owned;
  try {
    unlinkSync(lockPath);
    return { ok: true, value: undefined };
  } catch (e) {
    if (errCode(e) === "ENOENT") return { ok: true, value: undefined };
    return { ok: false, error: ioError(e) };
  }
}

export function isStale(lock: LockInfo, nowMs: number, budgetSec: number, graceSec: number): boolean {
  return nowMs - lock.startedAtMs > (budgetSec + graceSec) * 1000;
}

/** Overwrites a stale lock with a new buildId. Fails with `held` if the lock changed since it was read. */
export function reclaimStaleLock(
  lockPath: string,
  staleLock: LockInfo,
  clockMs: number,
): Result<ReclaimedLock, LockError> {
  const current = readLock(lockPath);
  if (!current.ok) return current;
  if (current.value !== null && current.value.buildId !== staleLock.buildId) {
    return { ok: false, error: { kind: "held" } };
  }
  const info = newLock(clockMs);
  try {
    writeFileSync(lockPath, JSON.stringify(info));
  } catch (e) {
    return { ok: false, error: ioError(e) };
  }
  return {
    ok: true,
    value: { ...info, reclaimed: { oldBuildId: staleLock.buildId, ageMs: clockMs - staleLock.startedAtMs } },
  };
}

/** Re-reads the lock file and checks that `buildId` still owns it. */
export function assertOwnsLock(lockPath: string, buildId: string): Result<void, LockError> {
  const current = readLock(lockPath);
  if (!current.ok) return current;
  if (current.value === null || current.value.buildId !== buildId) {
    return { ok: false, error: { kind: "not-owner" } };
  }
  return { ok: true, value: undefined };
}
