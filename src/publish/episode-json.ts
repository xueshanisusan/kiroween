import type { Result } from "../types.js";

export type EpisodeStory = { guid: string; title: string; script: string };

export type EpisodeJson = {
  generatedFor: string;
  selectedItemIds: string[];
  stories: EpisodeStory[];
};

export type EpisodeParseError = { kind: "invalid-field"; field: string; message: string };

/** Serializes with a fixed key order (generatedFor, selectedItemIds, stories[guid,title,script]). */
export function serializeEpisode(e: EpisodeJson): string {
  return JSON.stringify({
    generatedFor: e.generatedFor,
    selectedItemIds: e.selectedItemIds,
    stories: e.stories.map((s) => ({ guid: s.guid, title: s.title, script: s.script })),
  });
}

function fail(field: string, message: string): Result<EpisodeJson, EpisodeParseError> {
  return { ok: false, error: { kind: "invalid-field", field, message } };
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseEpisode(json: string): Result<EpisodeJson, EpisodeParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return fail("$", `invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("$", "expected a JSON object");
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.generatedFor !== "string") return fail("generatedFor", "must be a string");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.generatedFor)) {
    return fail("generatedFor", "must match YYYY-MM-DD");
  }
  if (!isRealDate(o.generatedFor)) return fail("generatedFor", "must be a real calendar date");

  const ids = o.selectedItemIds;
  if (!Array.isArray(ids)) return fail("selectedItemIds", "must be an array of strings");
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== "string") return fail(`selectedItemIds[${i}]`, "must be a string");
  }

  const stories = o.stories;
  if (!Array.isArray(stories)) return fail("stories", "must be an array");
  const out: EpisodeStory[] = [];
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      return fail(`stories[${i}]`, "must be an object");
    }
    const so = s as Record<string, unknown>;
    for (const k of ["guid", "title", "script"] as const) {
      if (typeof so[k] !== "string") return fail(`stories[${i}].${k}`, "must be a string");
    }
    out.push({ guid: so.guid as string, title: so.title as string, script: so.script as string });
  }

  return {
    ok: true,
    value: { generatedFor: o.generatedFor, selectedItemIds: ids as string[], stories: out },
  };
}
