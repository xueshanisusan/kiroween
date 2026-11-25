/** Success-or-error result used across the pipeline instead of throwing. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** One parsed Feed item. `pubDate` is a date string parseable by `Date.parse`. */
export type FeedItem = { guid: string; title: string; pubDate: string; contentEncoded: string };
