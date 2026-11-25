import { STORY_COUNT_CAP } from "../config/index.js";
import type { FeedItem } from "../types.js";

export type SelectionResult = {
  selected: FeedItem[];
  widened: boolean;
  coveredDates: string[];
};

const HOUR_MS = 60 * 60 * 1000;
const NARROW_WINDOW_MS = 48 * HOUR_MS;
const WIDE_WINDOW_MS = 7 * 24 * HOUR_MS;

type Dated = { item: FeedItem; time: number };

function newestFirst(a: Dated, b: Dated): number {
  if (a.time !== b.time) return b.time - a.time;
  return a.item.guid < b.item.guid ? -1 : a.item.guid > b.item.guid ? 1 : 0;
}

function campusDate(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Pure selection of up to 3 newest items; never reads the system clock. */
export function select(items: FeedItem[], now: Date, campusTimezone: string): SelectionResult {
  const nowMs = now.getTime();
  const dated: Dated[] = [];
  for (const item of items) {
    const time = Date.parse(item.pubDate);
    if (Number.isNaN(time) || time > nowMs) continue;
    dated.push({ item, time });
  }

  const within = (windowMs: number): Dated[] =>
    dated.filter((d) => nowMs - d.time <= windowMs).sort(newestFirst);

  const narrow = within(NARROW_WINDOW_MS);
  if (narrow.length >= STORY_COUNT_CAP) {
    return {
      selected: narrow.slice(0, STORY_COUNT_CAP).map((d) => d.item),
      widened: false,
      coveredDates: [],
    };
  }

  const wide = within(WIDE_WINDOW_MS).slice(0, STORY_COUNT_CAP);
  if (wide.length === 0) {
    return { selected: [], widened: false, coveredDates: [] };
  }
  const coveredDates = [...new Set(wide.map((d) => campusDate(d.time, campusTimezone)))].sort();
  return { selected: wide.map((d) => d.item), widened: true, coveredDates };
}
