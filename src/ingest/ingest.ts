import Parser from "rss-parser";
import { httpGet, type HttpClient } from "../lib/http.js";
import type { FeedItem, Result } from "../types.js";

export type IngestError =
  | { kind: "fetch-failed"; message: string }
  | { kind: "parse-failed"; message: string };

export type SkippedItem = { title: string; reason: "missing-field" | "bad-date" };

export type IngestResult = { items: FeedItem[]; skipped: SkippedItem[] };

type RawItem = {
  title?: string;
  guid?: string;
  pubDate?: string;
  contentEncoded?: string;
};

const parser = new Parser<Record<string, never>, RawItem>({
  customFields: { item: [["content:encoded", "contentEncoded"]] },
});

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Parse an RSS document. Only `guid`, `title`, `pubDate` and `content:encoded` are read.
 * Items missing a field, or with an unparseable `pubDate`, are returned in `skipped`.
 */
export async function parseFeed(xml: string): Promise<Result<IngestResult, IngestError>> {
  let feed;
  try {
    feed = await parser.parseString(xml);
  } catch (e) {
    return { ok: false, error: { kind: "parse-failed", message: e instanceof Error ? e.message : String(e) } };
  }
  const items: FeedItem[] = [];
  const skipped: SkippedItem[] = [];
  for (const raw of feed.items) {
    const title = nonEmpty(raw.title) ? raw.title : "(untitled)";
    if (!nonEmpty(raw.guid) || !nonEmpty(raw.title) || !nonEmpty(raw.pubDate) || !nonEmpty(raw.contentEncoded)) {
      skipped.push({ title, reason: "missing-field" });
      continue;
    }
    if (Number.isNaN(Date.parse(raw.pubDate))) {
      skipped.push({ title, reason: "bad-date" });
      continue;
    }
    items.push({ guid: raw.guid, title: raw.title, pubDate: raw.pubDate, contentEncoded: raw.contentEncoded });
  }
  return { ok: true, value: { items, skipped } };
}

/** Fetch the feed through `http` (one request, no article pages) and parse it. */
export async function fetchFeed(feedUrl: string, http: HttpClient): Promise<Result<IngestResult, IngestError>> {
  const res = await httpGet(http, feedUrl);
  if (!res.ok) return { ok: false, error: { kind: "fetch-failed", message: res.error.message } };
  return parseFeed(res.value.body);
}
