import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../types.js";
import { type EpisodeJson, serializeEpisode } from "./episode-json.js";

export const EPISODE_MP3_FILE = "episode.mp3";
export const EPISODE_JSON_FILE = "episode.json";

export type PublishError =
  | { kind: "lock-lost"; message: string }
  | { kind: "io-error"; message: string };

/** Returns ok if this build still owns the lock; any error means ownership was lost. */
export type OwnershipCheck = () => Result<void, unknown>;

function ioError(e: unknown): PublishError {
  return { kind: "io-error", message: e instanceof Error ? e.message : String(e) };
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // best effort
  }
}

/**
 * Writes one file via temp name + rename. The ownership check runs immediately
 * before the rename; if it fails the temp file is removed and nothing becomes visible.
 */
function writeAtomically(
  dir: string,
  name: string,
  data: Buffer | string,
  checkOwnership: OwnershipCheck,
): Result<void, PublishError> {
  const tmp = join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, data);
  } catch (e) {
    removeQuietly(tmp);
    return { ok: false, error: ioError(e) };
  }
  const owned = checkOwnership();
  if (!owned.ok) {
    removeQuietly(tmp);
    return { ok: false, error: { kind: "lock-lost", message: `lock ownership lost before publishing ${name}` } };
  }
  try {
    renameSync(tmp, join(dir, name));
  } catch (e) {
    removeQuietly(tmp);
    return { ok: false, error: ioError(e) };
  }
  return { ok: true, value: undefined };
}

/**
 * The only writer of Episode files (10.5). MP3 first, then Episode_JSON (10.4).
 * `checkOwnership` should wrap `assertOwnsLock(lockPath, buildId)`.
 */
export async function publish(
  episode: EpisodeJson,
  mp3: Buffer,
  dir: string,
  checkOwnership: OwnershipCheck,
): Promise<Result<void, PublishError>> {
  const mp3Result = writeAtomically(dir, EPISODE_MP3_FILE, mp3, checkOwnership);
  if (!mp3Result.ok) return mp3Result;
  return writeAtomically(dir, EPISODE_JSON_FILE, serializeEpisode(episode), checkOwnership);
}
