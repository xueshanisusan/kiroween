import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sampleEpisode,
  startWebTestServer,
  type WebTestServer,
} from "../../test/helpers/web-server.js";

type FileRecord = { size: number; mtimeMs: number; sha256: string };

function snapshot(dir: string): Record<string, FileRecord> {
  const out: Record<string, FileRecord> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = statSync(path);
    out[name] = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    };
  }
  return out;
}

describe("web service is read-only", () => {
  let s: WebTestServer;

  beforeEach(async () => {
    s = await startWebTestServer({ episode: sampleEpisode() });
  });

  afterEach(async () => {
    await s.close();
  });

  it("leaves the Data_Dir file set, sizes, mtimes and contents unchanged", async () => {
    const before = snapshot(s.dataDir);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    const requests: Array<[string, RequestInit | undefined]> = [
      ["/", undefined],
      ["/episode.json", undefined],
      ["/episode.mp3", undefined],
      ["/episode.mp3", { headers: { Range: "bytes=0-9" } }],
      ["/", { method: "HEAD" }],
      ["/does-not-exist", undefined],
      ["/", { method: "POST" }],
    ];
    const statuses: number[] = [];
    for (const [path, init] of requests) {
      const res = await fetch(`${s.baseUrl}${path}`, init);
      await res.arrayBuffer();
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 206, 200, 404, 405]);

    expect(snapshot(s.dataDir)).toEqual(before);
  });
});
