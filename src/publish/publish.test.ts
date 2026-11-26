import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, assertOwnsLock } from "../pipeline/lock.js";
import { type EpisodeJson, parseEpisode } from "./episode-json.js";
import { EPISODE_JSON_FILE, EPISODE_MP3_FILE, publish } from "./publish.js";

const episode: EpisodeJson = {
  generatedFor: "2026-11-24",
  selectedItemIds: ["a"],
  stories: [{ guid: "a", title: "T", script: "S" }],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "publish-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("publish", () => {
  it("renames MP3 before JSON and leaves no temp files", async () => {
    const order: string[] = [];
    const res = await publish(episode, Buffer.from([1, 2, 3]), dir, () => {
      order.push(readdirSync(dir).filter((f) => !f.endsWith(".tmp")).join(","));
      return { ok: true, value: undefined };
    });
    expect(res.ok).toBe(true);
    // At first check (before MP3 rename) nothing visible; at second, only the MP3.
    expect(order).toEqual(["", EPISODE_MP3_FILE]);
    expect(readdirSync(dir).sort()).toEqual([EPISODE_JSON_FILE, EPISODE_MP3_FILE]);
    expect(readFileSync(join(dir, EPISODE_MP3_FILE))).toEqual(Buffer.from([1, 2, 3]));
    expect(parseEpisode(readFileSync(join(dir, EPISODE_JSON_FILE), "utf8")).ok).toBe(true);
  });

  it("writes nothing and keeps the previous Episode when ownership is lost", async () => {
    const lockPath = join(dir, "lock");
    const lock = acquireLock(lockPath, 0);
    if (!lock.ok) throw new Error("lock");
    writeFileSync(join(dir, EPISODE_MP3_FILE), "old-mp3");
    writeFileSync(join(dir, EPISODE_JSON_FILE), "old-json");
    const before = readdirSync(dir).sort();

    const res = await publish(episode, Buffer.from("new"), dir, () =>
      assertOwnsLock(lockPath, "someone-else"),
    );
    expect(res).toEqual({ ok: false, error: expect.objectContaining({ kind: "lock-lost" }) });
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(readFileSync(join(dir, EPISODE_MP3_FILE), "utf8")).toBe("old-mp3");
    expect(readFileSync(join(dir, EPISODE_JSON_FILE), "utf8")).toBe("old-json");
  });

  it("keeps old JSON and does not write new JSON if ownership is lost between MP3 and JSON", async () => {
    let calls = 0;
    const res = await publish(episode, Buffer.from("m"), dir, () =>
      ++calls === 1 ? { ok: true, value: undefined } : { ok: false, error: { kind: "not-owner" } },
    );
    expect(res.ok).toBe(false);
    expect(readdirSync(dir)).toEqual([EPISODE_MP3_FILE]);
  });

  it("reading an invalid Episode_JSON does not modify it", () => {
    const path = join(dir, EPISODE_JSON_FILE);
    const bad = '{"generatedFor": 5}';
    writeFileSync(path, bad);
    const parsed = parseEpisode(readFileSync(path, "utf8"));
    expect(parsed.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(bad);
    expect(readdirSync(dir)).toEqual([EPISODE_JSON_FILE]);
  });
});
