import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type EpisodeJson, parseEpisode } from "../publish/episode-json.js";
import { EPISODE_JSON_FILE, EPISODE_MP3_FILE } from "../publish/publish.js";
import type { Result } from "../types.js";

export type PublishedEpisode = {
  episode: EpisodeJson;
  mp3Path: string;
  /** Size of episode.mp3 in bytes (always > 0). */
  mp3SizeBytes: number;
};

export type EpisodeLoadError =
  | { kind: "no-episode" }
  | { kind: "invalid-field"; field: string; message: string }
  | { kind: "empty-mp3" };

/**
 * Reads the published Episode_JSON and stats the Episode_MP3 in `dataDir`.
 * One readFileSync and one statSync per call. Read-only; never throws for
 * missing, unreadable, corrupt or empty files.
 */
export function loadEpisode(dataDir: string): Result<PublishedEpisode, EpisodeLoadError> {
  let text: string;
  try {
    text = readFileSync(join(dataDir, EPISODE_JSON_FILE), "utf8");
  } catch {
    return { ok: false, error: { kind: "no-episode" } };
  }

  const parsed = parseEpisode(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { kind: "invalid-field", field: parsed.error.field, message: parsed.error.message },
    };
  }

  const mp3Path = join(dataDir, EPISODE_MP3_FILE);
  let size: number;
  try {
    const st = statSync(mp3Path);
    if (!st.isFile()) return { ok: false, error: { kind: "empty-mp3" } };
    size = st.size;
  } catch {
    return { ok: false, error: { kind: "empty-mp3" } };
  }
  if (size === 0) return { ok: false, error: { kind: "empty-mp3" } };

  return { ok: true, value: { episode: parsed.value, mp3Path, mp3SizeBytes: size } };
}
