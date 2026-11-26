import { describe, expect, it } from "vitest";
import { INTRO_WORDS, OUTRO_WORDS } from "../config/index.js";
import { assembleScript, buildIntro, OUTRO_TEXT } from "./assemble.js";

const now = new Date("2026-11-24T15:00:00Z");
const words = (s: string): number => s.trim().split(/\s+/).length;

describe("buildIntro", () => {
  it("3 survivors: 20 words, outlet and date once, no short-briefing wording", () => {
    const intro = buildIntro({ survivorCount: 3, now });
    expect(words(intro)).toBe(INTRO_WORDS);
    expect(intro.match(/MIT/g)).toHaveLength(1);
    expect(intro.match(/November 24/g)).toHaveLength(1);
    expect(intro).toContain("Tuesday, November 24");
    expect(intro).not.toContain("short briefing today");
  });

  it("2 survivors: short briefing today, 20 words", () => {
    const intro = buildIntro({ survivorCount: 2, now });
    expect(intro).toContain("short briefing today");
    expect(intro).toContain("two stories");
    expect(words(intro)).toBe(INTRO_WORDS);
  });

  it("1 survivor: short briefing today, 20 words", () => {
    const intro = buildIntro({ survivorCount: 1, now });
    expect(intro).toContain("short briefing today");
    expect(intro).toContain("one story");
    expect(words(intro)).toBe(INTRO_WORDS);
  });

  it("widened: includes covered dates", () => {
    const intro = buildIntro({ survivorCount: 3, now, coveredDates: ["2026-11-20", "2026-11-23"] });
    expect(intro).toContain("These stories are from November 20 and November 23.");
  });

  it("not widened: no covered-dates sentence", () => {
    expect(buildIntro({ survivorCount: 3, now, coveredDates: [] })).not.toContain("These stories are from");
  });
});

describe("assembleScript", () => {
  it("orders intro, stories in selection order, outro", () => {
    const script = assembleScript("INTRO", ["A", "B", "C"]);
    expect(script).toBe(`INTRO\n\nA\n\nB\n\nC\n\n${OUTRO_TEXT}`);
  });

  it("outro is 15 words", () => {
    expect(words(OUTRO_TEXT)).toBe(OUTRO_WORDS);
  });
});
