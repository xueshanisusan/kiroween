import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeedItem } from "../types.js";
import { select } from "./select.js";

const TZ = "America/New_York";

/** Minimal in-test parse of the synthetic fixture (ingestor not required). */
function loadFixtureItems(): FeedItem[] {
  const xml = readFileSync("content/fixtures/synthetic-3-items.xml", "utf8");
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const tag = (block: string, name: string): string =>
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? "";
  return blocks.map((b) => ({
    guid: tag(b, "guid"),
    title: tag(b, "title"),
    pubDate: tag(b, "pubDate"),
    contentEncoded: tag(b, "content:encoded"),
  }));
}

describe("select (synthetic fixture)", () => {
  const items = loadFixtureItems();

  it("parses three fixture items", () => {
    expect(items).toHaveLength(3);
  });

  it("selects newest first and does not widen when 3 items are within 48h", () => {
    const [a, b, c] = items;
    // Re-date the items so all three fall inside the 48h window.
    const recent = [
      { ...a!, pubDate: "Thu, 19 Nov 2026 09:00:00 -0500" },
      { ...b!, pubDate: "Fri, 20 Nov 2026 08:00:00 -0500" },
      { ...c!, pubDate: "Fri, 20 Nov 2026 10:00:00 -0500" },
    ];
    const now = new Date("2026-11-20T18:00:00-05:00");
    const r = select(recent, now, TZ);
    expect(r.widened).toBe(false);
    expect(r.coveredDates).toEqual([]);
    expect(r.selected.map((i) => i.guid)).toEqual([c!.guid, b!.guid, a!.guid]);
  });

  it("widens to 7 days and returns coveredDates when fewer than 3 are within 48h", () => {
    const now = new Date("2026-11-20T12:00:00-05:00");
    const r = select(items, now, TZ);
    expect(r.widened).toBe(true);
    expect(r.selected.map((i) => i.pubDate)).toEqual([
      items[2]!.pubDate,
      items[1]!.pubDate,
      items[0]!.pubDate,
    ]);
    expect(r.coveredDates).toEqual(["2026-11-16", "2026-11-18", "2026-11-20"]);
  });

  it("returns nothing when no item is within 7 days", () => {
    const r = select(items, new Date("2026-12-31T12:00:00-05:00"), TZ);
    expect(r.selected).toEqual([]);
    expect(r.widened).toBe(false);
  });

  it("breaks pubDate ties by guid ascending", () => {
    const [a, b, c] = items;
    const same = "Fri, 20 Nov 2026 08:05:00 -0500";
    const tied = [
      { ...a!, guid: "guid-c", pubDate: same },
      { ...b!, guid: "guid-a", pubDate: same },
      { ...c!, guid: "guid-b", pubDate: same },
    ];
    const r = select(tied, new Date("2026-11-20T12:00:00-05:00"), TZ);
    expect(r.selected.map((i) => i.guid)).toEqual(["guid-a", "guid-b", "guid-c"]);
  });
});
