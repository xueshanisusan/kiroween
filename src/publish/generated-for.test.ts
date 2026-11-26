import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatedFor } from "./generated-for.js";
import { parseEpisode, serializeEpisode, type EpisodeJson } from "./episode-json.js";

const valid: EpisodeJson = {
  generatedFor: "2026-11-24",
  selectedItemIds: ["a", "b"],
  stories: [{ guid: "a", title: "T", script: "S" }],
};

function fieldOf(mutate: (o: Record<string, unknown>) => void): string | undefined {
  const o = JSON.parse(serializeEpisode(valid)) as Record<string, unknown>;
  mutate(o);
  const r = parseEpisode(JSON.stringify(o));
  return r.ok ? undefined : r.error.field;
}

describe("parseEpisode names the corrupted field (Property 17)", () => {
  // **Validates: Requirements 10.8**
  it("generatedFor wrong type", () => expect(fieldOf((o) => (o.generatedFor = 5))).toBe("generatedFor"));
  it("generatedFor missing", () => expect(fieldOf((o) => delete o.generatedFor)).toBe("generatedFor"));
  it("selectedItemIds wrong type", () =>
    expect(fieldOf((o) => (o.selectedItemIds = "x"))).toBe("selectedItemIds"));
  it("selectedItemIds missing", () =>
    expect(fieldOf((o) => delete o.selectedItemIds)).toBe("selectedItemIds"));
  it("stories wrong type", () => expect(fieldOf((o) => (o.stories = {}))).toBe("stories"));
  it("stories missing", () => expect(fieldOf((o) => delete o.stories)).toBe("stories"));
  for (const k of ["guid", "title", "script"]) {
    it(`story ${k} wrong type`, () =>
      expect(fieldOf((o) => ((o.stories as Record<string, unknown>[])[0]![k] = 1))).toContain(k));
    it(`story ${k} missing`, () =>
      expect(fieldOf((o) => delete (o.stories as Record<string, unknown>[])[0]![k])).toContain(k));
  }

  it("a parse error never touches the file it came from (10.10)", () => {
    // **Validates: Requirements 10.10**
    const dir = mkdtempSync(join(tmpdir(), "episode-"));
    const file = join(dir, "episode.json");
    const bad = '{"generatedFor": 5}';
    writeFileSync(file, bad);
    const r = parseEpisode(readFileSync(file, "utf8"));
    expect(r.ok).toBe(false);
    expect(readdirSync(dir)).toEqual(["episode.json"]);
    expect(readFileSync(file, "utf8")).toBe(bad);
  });
});

describe("generatedFor (Property 19)", () => {
  // **Validates: Requirements 12.1, 12.2, 12.3**
  const tz = "America/New_York";
  const fmt = /^\d{4}-\d{2}-\d{2}$/;

  it("uses the local date just before and after local midnight", () => {
    expect(generatedFor(new Date("2026-11-24T04:59:59Z"), tz)).toBe("2026-11-23");
    expect(generatedFor(new Date("2026-11-24T05:00:00Z"), tz)).toBe("2026-11-24");
  });

  it("differs from the UTC date late in the local evening", () => {
    expect(generatedFor(new Date("2026-11-25T02:30:00Z"), tz)).toBe("2026-11-24");
  });

  it("is correct across spring-forward (2026-03-08)", () => {
    expect(generatedFor(new Date("2026-03-08T04:59:59Z"), tz)).toBe("2026-03-07");
    expect(generatedFor(new Date("2026-03-08T05:00:00Z"), tz)).toBe("2026-03-08");
    expect(generatedFor(new Date("2026-03-09T03:59:59Z"), tz)).toBe("2026-03-08");
    expect(generatedFor(new Date("2026-03-09T04:00:00Z"), tz)).toBe("2026-03-09");
  });

  it("is correct across fall-back (2026-11-01)", () => {
    expect(generatedFor(new Date("2026-11-01T03:59:59Z"), tz)).toBe("2026-10-31");
    expect(generatedFor(new Date("2026-11-01T04:00:00Z"), tz)).toBe("2026-11-01");
    expect(generatedFor(new Date("2026-11-02T04:59:59Z"), tz)).toBe("2026-11-01");
    expect(generatedFor(new Date("2026-11-02T05:00:00Z"), tz)).toBe("2026-11-02");
  });

  it("always matches YYYY-MM-DD and is accepted by parseEpisode", () => {
    for (const iso of ["2026-03-08T05:00:00Z", "2026-11-01T04:00:00Z", "2026-12-31T23:59:59Z"]) {
      const d = generatedFor(new Date(iso), tz);
      expect(d).toMatch(fmt);
      expect(parseEpisode(serializeEpisode({ ...valid, generatedFor: d })).ok).toBe(true);
    }
  });
});
