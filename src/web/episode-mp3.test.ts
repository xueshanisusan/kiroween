import { get } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sampleEpisode,
  startWebTestServer,
  type WebTestServer,
} from "../../test/helpers/web-server.js";

async function waitForRequestLogs(
  s: WebTestServer,
  count: number,
): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 100; i++) {
    const lines = s.logLines().filter((l) => l["event"] === "request");
    if (lines.length >= count) return lines;
    await new Promise((r) => setTimeout(r, 10));
  }
  return s.logLines().filter((l) => l["event"] === "request");
}

async function getBytes(url: string, range?: string): Promise<{ res: Response; bytes: Buffer }> {
  const res = await fetch(url, range === undefined ? {} : { headers: { Range: range } });
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

describe("GET /episode.mp3", () => {
  let s: WebTestServer;
  let mp3: Buffer;
  let url: string;
  let size: number;

  beforeEach(async () => {
    s = await startWebTestServer();
    mp3 = s.publish(sampleEpisode());
    size = mp3.length;
    url = `${s.baseUrl}/episode.mp3`;
  });

  afterEach(async () => {
    await s.close();
  });

  it("serves the whole file with length, ranges and audio/mpeg headers", async () => {
    const { res, bytes } = await getBytes(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(bytes.equals(mp3)).toBe(true);
  });

  it("serves a closed range as 206 with exact bytes", async () => {
    const { res, bytes } = await getBytes(url, "bytes=10-19");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
    expect(res.headers.get("content-length")).toBe("10");
    expect(bytes.equals(mp3.subarray(10, 20))).toBe(true);
  });

  it("serves an open-ended range to the end of the file", async () => {
    const { res, bytes } = await getBytes(url, "bytes=100-");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 100-${size - 1}/${size}`);
    expect(bytes.equals(mp3.subarray(100))).toBe(true);
  });

  it("serves a suffix range as the last bytes", async () => {
    const { res, bytes } = await getBytes(url, "bytes=-25");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes ${size - 25}-${size - 1}/${size}`);
    expect(bytes.equals(mp3.subarray(size - 25))).toBe(true);
  });

  it("returns the whole file when the suffix is longer than the file", async () => {
    const { res, bytes } = await getBytes(url, `bytes=-${size + 1000}`);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-${size - 1}/${size}`);
    expect(bytes.equals(mp3)).toBe(true);
  });

  it("clamps an end beyond the file", async () => {
    const { res, bytes } = await getBytes(url, `bytes=5-${size + 5000}`);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 5-${size - 1}/${size}`);
    expect(res.headers.get("content-length")).toBe(String(size - 5));
    expect(bytes.equals(mp3.subarray(5))).toBe(true);
  });

  it.each([
    ["start at the size", () => `bytes=${size}-`],
    ["start beyond the size", () => `bytes=${size + 10}-${size + 20}`],
    ["a syntactically invalid range", () => "bytes=abc-def"],
    ["a multi-range request", () => "bytes=0-1,5-6"],
  ])("answers 416 for %s", async (_name, header) => {
    const { res, bytes } = await getBytes(url, header());
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${size}`);
    expect(bytes.length).toBe(0);
  });

  it("serves a non-bytes range unit as a full 200", async () => {
    const { res, bytes } = await getBytes(url, "items=0-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
    expect(bytes.equals(mp3)).toBe(true);
  });

  it("HEAD mirrors the GET headers with no body", async () => {
    const get200 = await fetch(url);
    await get200.arrayBuffer();
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    for (const h of ["content-length", "content-type", "accept-ranges", "etag"]) {
      expect(head.headers.get(h)).toBe(get200.headers.get(h));
    }
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it("answers 304 for a matching If-None-Match", async () => {
    const first = await fetch(url);
    await first.arrayBuffer();
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await fetch(url, { headers: { "If-None-Match": etag as string } });
    expect(res.status).toBe(304);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it("answers 404 when no episode is published", async () => {
    s.unpublish();
    const res = await fetch(url);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no-episode" });
  });

  it("keeps serving after a client aborts mid-stream", async () => {
    await new Promise<void>((resolve) => {
      const req = get(url, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
        res.on("error", () => undefined);
      });
      req.on("error", () => undefined);
    });
    const { res, bytes } = await getBytes(url);
    expect(res.status).toBe(200);
    expect(bytes.equals(mp3)).toBe(true);
  });

  it("logs rangeStart and rangeEnd for a 206", async () => {
    const { res } = await getBytes(url, "bytes=10-19");
    expect(res.status).toBe(206);
    const lines = await waitForRequestLogs(s, 1);
    const line = lines.find((l) => l["status"] === 206);
    expect(line).toBeDefined();
    expect(line?.["rangeStart"]).toBe(10);
    expect(line?.["rangeEnd"]).toBe(19);
  });
});
