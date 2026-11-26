import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "../lib/http.js";
import { fetchFeed, parseFeed } from "./ingest.js";

const fixture = readFileSync(new URL("../../content/fixtures/synthetic-3-items.xml", import.meta.url), "utf8");

/** Replace the first occurrence of `from` inside the fixture text. */
function mod(from: string | RegExp, to: string): string {
  const out = fixture.replace(from, to);
  expect(out).not.toBe(fixture);
  return out;
}

async function parseOk(xml: string) {
  const r = await parseFeed(xml);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("parseFeed", () => {
  it("parses the fixture into three items with all four fields", async () => {
    const { items, skipped } = await parseOk(fixture);
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.guid).toMatch(/^https:\/\/example\.test\//);
      expect(it.title.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(it.pubDate))).toBe(false);
      expect(it.contentEncoded).toContain("<p>");
    }
    expect(items[0]!.contentEncoded).toContain("&mdash;");
    expect(items[1]!.contentEncoded).toContain("<a href");
  });

  it("skips an item with a missing guid", async () => {
    const xml = mod(/<guid[^>]*>[^<]*<\/guid>/, "");
    const { items, skipped } = await parseOk(xml);
    expect(items).toHaveLength(2);
    expect(skipped).toEqual([
      { title: "Quartzfield team builds a tide-powered desalination buoy", reason: "missing-field" },
    ]);
  });

  it("skips an item with missing content:encoded", async () => {
    const xml = mod(/<content:encoded>[\s\S]*?<\/content:encoded>/, "");
    const { items, skipped } = await parseOk(xml);
    expect(items).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe("missing-field");
  });

  it("skips an item with a bad pubDate", async () => {
    const xml = mod(/<pubDate>Mon, 16 Nov 2026[^<]*<\/pubDate>/, "<pubDate>not a date</pubDate>");
    const { items, skipped } = await parseOk(xml);
    expect(items).toHaveLength(2);
    expect(skipped).toEqual([
      { title: "Quartzfield team builds a tide-powered desalination buoy", reason: "bad-date" },
    ]);
  });

  it("returns parse-failed for malformed XML", async () => {
    const r = await parseFeed("<rss><channel><item></rss>");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse-failed");
  });
});

describe("fetchFeed", () => {
  it("requests only the feed URL and returns parsed items", async () => {
    const urls: string[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        urls.push(req.url);
        return { ok: true, value: { status: 200, body: fixture } };
      },
    };
    const r = await fetchFeed("https://example.test/rss/feed", http);
    expect(r.ok && r.value.items).toHaveLength(3);
    expect(urls).toEqual(["https://example.test/rss/feed"]);
  });

  it("returns a typed fetch-failed error when the client fails after retry", async () => {
    const http: HttpClient = {
      async request() {
        return { ok: false, error: { kind: "network", message: "boom", attempts: 2 } };
      },
    };
    const r = await fetchFeed("https://example.test/rss/feed", http);
    expect(r).toEqual({ ok: false, error: { kind: "fetch-failed", message: "boom" } });
  });
});
