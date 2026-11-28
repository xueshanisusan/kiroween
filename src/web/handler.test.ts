import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WEB_CONFIG, type WebConfig } from "../config/index.js";
import {
  sampleEpisode,
  startWebTestServer,
  type WebTestServer,
} from "../../test/helpers/web-server.js";
import { EPISODE_JSON_FILE, EPISODE_MP3_FILE } from "../publish/publish.js";

const EMPTY = WEB_CONFIG.emptyStateMessage;

async function waitForLogs(s: WebTestServer, count: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 100; i++) {
    const lines = s.logLines().filter((l) => l["event"] === "request");
    if (lines.length >= count) return lines;
    await new Promise((r) => setTimeout(r, 10));
  }
  return s.logLines().filter((l) => l["event"] === "request");
}

describe("request handler", () => {
  let s: WebTestServer;

  beforeEach(async () => {
    s = await startWebTestServer();
  });

  afterEach(async () => {
    await s.close();
  });

  it("GET / with a published episode serves HTML with an audio element", async () => {
    s.publish(sampleEpisode());
    const res = await fetch(`${s.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<audio");
    expect(body).toContain("First story");
    expect(body).not.toContain(EMPTY);
  });

  it("GET / with no episode serves the empty state and no audio", async () => {
    const res = await fetch(`${s.baseUrl}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(EMPTY);
    expect(body).not.toContain("<audio");
  });

  it("serves the empty page for a corrupt episode.json", async () => {
    s.publish(sampleEpisode());
    writeFileSync(join(s.dataDir, EPISODE_JSON_FILE), "{not json");
    const res = await fetch(`${s.baseUrl}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(EMPTY);
    expect(body).not.toContain("<audio");
  });

  it("serves the empty page when the MP3 is missing", async () => {
    s.publish(sampleEpisode());
    writeFileSync(join(s.dataDir, EPISODE_MP3_FILE), Buffer.alloc(0));
    const res = await fetch(`${s.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(EMPTY);
  });

  it("HEAD / matches GET / headers and has no body", async () => {
    s.publish(sampleEpisode());
    const get = await fetch(`${s.baseUrl}/`);
    const head = await fetch(`${s.baseUrl}/`, { method: "HEAD" });
    expect(head.status).toBe(get.status);
    for (const h of ["content-type", "content-length", "x-content-type-options", "referrer-policy"]) {
      expect(head.headers.get(h)).toBe(get.headers.get(h));
    }
    expect(await head.text()).toBe("");
  });

  it("GET /episode.json serves 200 with Cache-Control and ETag, then 304", async () => {
    const e = sampleEpisode();
    s.publish(e);
    const res = await fetch(`${s.baseUrl}/episode.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe(`max-age=${WEB_CONFIG.jsonCacheMaxAgeSeconds}`);
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(JSON.parse(await res.text())).toEqual(e);

    const again = await fetch(`${s.baseUrl}/episode.json`, { headers: { "If-None-Match": etag! } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  it("GET /episode.json is 404 with an error code when nothing is published", async () => {
    const res = await fetch(`${s.baseUrl}/episode.json`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no-episode" });
  });

  it("unknown path is 404", async () => {
    const res = await fetch(`${s.baseUrl}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
  });

  it("POST / is 405 with Allow: GET, HEAD", async () => {
    const res = await fetch(`${s.baseUrl}/`, { method: "POST", body: "x" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("GET /healthz is 200 with and without an episode", async () => {
    const without = await fetch(`${s.baseUrl}/healthz`);
    expect(without.status).toBe(200);
    expect(await without.json()).toEqual({ status: "ok" });
    s.publish(sampleEpisode());
    const withEp = await fetch(`${s.baseUrl}/healthz`);
    expect(withEp.status).toBe(200);
  });

  it("sets nosniff and no-referrer on every response", async () => {
    s.publish(sampleEpisode());
    const responses = [
      await fetch(`${s.baseUrl}/`),
      await fetch(`${s.baseUrl}/episode.json`),
      await fetch(`${s.baseUrl}/episode.mp3`),
      await fetch(`${s.baseUrl}/healthz`),
      await fetch(`${s.baseUrl}/missing`),
      await fetch(`${s.baseUrl}/`, { method: "POST" }),
    ];
    for (const r of responses) {
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
      await r.arrayBuffer();
    }
  });

  it("ignores the query string when routing", async () => {
    s.publish(sampleEpisode());
    const a = await fetch(`${s.baseUrl}/?x=1&y=2`);
    expect(a.status).toBe(200);
    expect(await a.text()).toContain("<audio");
    const b = await fetch(`${s.baseUrl}/healthz?foo=bar`);
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual({ status: "ok" });
  });

  it("serves a newly written episode on the next request without restart", async () => {
    s.publish(sampleEpisode("2026-11-24", "Old headline"));
    expect(await (await fetch(`${s.baseUrl}/`)).text()).toContain("Old headline");
    s.publish(sampleEpisode("2026-11-25", "New headline"));
    const body = await (await fetch(`${s.baseUrl}/`)).text();
    expect(body).toContain("New headline");
    expect(body).not.toContain("Old headline");
  });

  it("writes one log line per request with the Requirement 10.2 fields and no headers", async () => {
    s.publish(sampleEpisode());
    const res = await fetch(`${s.baseUrl}/episode.json?secret=abc`, {
      headers: { Authorization: "Bearer topsecret", Cookie: "sid=123" },
    });
    await res.arrayBuffer();
    const lines = await waitForLogs(s, 1);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toMatchObject({
      event: "request",
      route: "/episode.json",
      method: "GET",
      status: 200,
      briefingId: "web-test",
    });
    expect(typeof line["durationMs"]).toBe("number");
    expect(typeof line["bytesSent"]).toBe("number");
    expect(line["bytesSent"]).toBeGreaterThan(0);
    expect(typeof line["requestId"]).toBe("string");
    const raw = JSON.stringify(line);
    expect(raw).not.toContain("topsecret");
    expect(raw).not.toContain("sid=123");
    expect(raw).not.toContain("secret=abc");
    expect(line).not.toHaveProperty("headers");
  });

  it("logs unknown paths with route 'other'", async () => {
    await (await fetch(`${s.baseUrl}/whatever`)).arrayBuffer();
    const lines = await waitForLogs(s, 1);
    expect(lines[0]).toMatchObject({ route: "other", status: 404 });
  });
});

describe("request handler with a throwing route", () => {
  it("returns 500 and keeps serving later requests", async () => {
    // A config whose outletName getter throws makes the root route throw; healthz does not read config.
    const throwingConfig: WebConfig = {
      ...WEB_CONFIG,
      get outletName(): string {
        throw new Error("boom");
      },
    };
    const s = await startWebTestServer({ config: throwingConfig });
    try {
      const bad = await fetch(`${s.baseUrl}/`);
      expect(bad.status).toBe(500);
      expect(await bad.json()).toEqual({ error: "internal-error" });
      expect(bad.headers.get("x-content-type-options")).toBe("nosniff");

      const ok = await fetch(`${s.baseUrl}/healthz`);
      expect(ok.status).toBe(200);

      const again = await fetch(`${s.baseUrl}/`);
      expect(again.status).toBe(500);
    } finally {
      await s.close();
    }
  });
});
