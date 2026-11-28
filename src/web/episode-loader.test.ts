import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMp3 } from "../../test/helpers/mp3.js";
import { type EpisodeJson, serializeEpisode } from "../publish/episode-json.js";
import { EPISODE_JSON_FILE, EPISODE_MP3_FILE } from "../publish/publish.js";
import { loadEpisode } from "./episode-loader.js";

function episode(generatedFor: string, title: string): EpisodeJson {
  return {
    generatedFor,
    selectedItemIds: ["g1"],
    stories: [{ guid: "g1", title, script: `Script for ${title}.` }],
  };
}

describe("loadEpisode", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "episode-loader-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePair(e: EpisodeJson, seconds = 2): Buffer {
    const mp3 = buildMp3({ seconds }).bytes;
    writeFileSync(join(dir, EPISODE_JSON_FILE), serializeEpisode(e));
    writeFileSync(join(dir, EPISODE_MP3_FILE), mp3);
    return mp3;
  }

  it("loads a valid pair", () => {
    const e = episode("2026-11-24", "First");
    const mp3 = writePair(e);
    const r = loadEpisode(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.episode).toEqual(e);
    expect(r.value.mp3Path).toBe(join(dir, EPISODE_MP3_FILE));
    expect(r.value.mp3SizeBytes).toBe(mp3.length);
  });

  it("returns no-episode when the Data_Dir does not exist", () => {
    const r = loadEpisode(join(dir, "does-not-exist"));
    expect(r).toEqual({ ok: false, error: { kind: "no-episode" } });
  });

  it("returns no-episode when episode.json is missing", () => {
    writeFileSync(join(dir, EPISODE_MP3_FILE), buildMp3({ seconds: 1 }).bytes);
    expect(loadEpisode(dir)).toEqual({ ok: false, error: { kind: "no-episode" } });
  });

  it("returns empty-mp3 when episode.mp3 is missing", () => {
    writeFileSync(join(dir, EPISODE_JSON_FILE), serializeEpisode(episode("2026-11-24", "A")));
    expect(loadEpisode(dir)).toEqual({ ok: false, error: { kind: "empty-mp3" } });
  });

  it("returns empty-mp3 when episode.mp3 has zero bytes", () => {
    writeFileSync(join(dir, EPISODE_JSON_FILE), serializeEpisode(episode("2026-11-24", "A")));
    writeFileSync(join(dir, EPISODE_MP3_FILE), Buffer.alloc(0));
    expect(loadEpisode(dir)).toEqual({ ok: false, error: { kind: "empty-mp3" } });
  });

  it("names the invalid field for corrupt episode.json", () => {
    writeFileSync(join(dir, EPISODE_MP3_FILE), buildMp3({ seconds: 1 }).bytes);
    writeFileSync(
      join(dir, EPISODE_JSON_FILE),
      JSON.stringify({ generatedFor: "2026-11-24", selectedItemIds: [], stories: [{ guid: "g" }] }),
    );
    const r = loadEpisode(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid-field");
    if (r.error.kind === "invalid-field") expect(r.error.field).toBe("stories[0].title");
  });

  it("reports $ for unparseable JSON without throwing", () => {
    writeFileSync(join(dir, EPISODE_MP3_FILE), buildMp3({ seconds: 1 }).bytes);
    writeFileSync(join(dir, EPISODE_JSON_FILE), "{not json");
    const r = loadEpisode(dir);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "invalid-field") expect(r.error.field).toBe("$");
  });

  it("sees a replaced pair on the second call", () => {
    writePair(episode("2026-11-24", "Old"), 1);
    const first = loadEpisode(dir);
    expect(first.ok).toBe(true);

    const newer = episode("2026-11-25", "New");
    const newMp3 = writePair(newer, 3);
    const second = loadEpisode(dir);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.episode).toEqual(newer);
    expect(second.value.mp3SizeBytes).toBe(newMp3.length);
    expect(second.value.mp3SizeBytes).not.toBe(first.value.mp3SizeBytes);
  });
});
