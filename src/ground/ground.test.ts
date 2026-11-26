import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalize } from "../ingest/normalize.js";
import { checkGrounding } from "./ground.js";

// Extract content:encoded of each <item> from the fixture (CDATA or entity-escaped).
function fixtureContents(): string[] {
  const xml = readFileSync(new URL("../../content/fixtures/synthetic-3-items.xml", import.meta.url), "utf8");
  const out: string[] = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const m = /<content:encoded>([\s\S]*?)<\/content:encoded>/.exec(item[1]!)!;
    let body = m[1]!;
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(body.trim());
    if (cdata) {
      body = cdata[1]!;
    } else {
      body = body
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
    }
    out.push(body);
  }
  return out;
}

const [buoy, sleep] = fixtureContents().map((c) => normalize(c).sourceText) as [string, string, string];
const MONDAY = "Monday"; // pubDate weekday of the buoy item (16 Nov 2026)

describe("checkGrounding", () => {
  it("passes a script whose entities all appear in the source", () => {
    const script =
      "Engineers at Quartzfield Institute built a buoy that produced 1,850 liters of water per day, says Helena Voss.";
    expect(checkGrounding(script, buoy, MONDAY)).toEqual({ passed: true, missing: [] });
  });

  // Property 14
  it("fails a script using entities present only in a second Source_Text", () => {
    const script = "Rafael Menendez and the Eastbrook team surveyed 2,400 students.";
    expect(checkGrounding(script, sleep, "Wednesday").passed).toBe(true);
    const res = checkGrounding(script, buoy, MONDAY);
    expect(res.passed).toBe(false);
    expect(res.missing).toEqual(expect.arrayContaining(["Rafael Menendez", "2,400"]));
  });

  describe("weekdays", () => {
    it("accepts the pubDate weekday even when absent from the source", () => {
      expect(buoy).not.toMatch(/Monday/);
      expect(checkGrounding("On Monday engineers shared news.", buoy, MONDAY).passed).toBe(true);
    });

    it("accepts a weekday literally present in the source", () => {
      const src = normalize("<p>The vote happens on Thursday afternoon.</p>").sourceText;
      expect(checkGrounding("The vote is on Thursday.", src, MONDAY).passed).toBe(true);
    });

    it("rejects a weekday that is neither the pubDate weekday nor in the source", () => {
      const res = checkGrounding("The vote is on Tuesday.", buoy, MONDAY);
      expect(res.passed).toBe(false);
      expect(res.missing).toEqual(["Tuesday"]);
    });
  });

  describe("normalization of dates and numbers", () => {
    it("treats the month abbreviation Jan as equal to January", () => {
      expect(buoy).toMatch(/January 2027/);
      expect(checkGrounding("The pilot starts in Jan.", buoy, MONDAY).passed).toBe(true);
    });

    it("treats an abbreviated month and day as the same date", () => {
      expect(buoy).toMatch(/November 10/);
      expect(checkGrounding("It was published Nov. 10.", buoy, MONDAY).passed).toBe(true);
      expect(checkGrounding("It was published Nov. 11.", buoy, MONDAY).passed).toBe(false);
    });

    it("treats the ordinal 3rd as equal to 3", () => {
      expect(buoy).toMatch(/three coastal communities/);
      expect(checkGrounding("The pilot covers the 3rd community of 3 sites.", buoy, MONDAY).passed).toBe(true);
    });

    it("rejects a number absent from the source", () => {
      const res = checkGrounding("It produced 9,999 liters.", buoy, MONDAY);
      expect(res).toEqual({ passed: false, missing: ["9,999"] });
    });
  });

  describe("Sentence_Starter_Stoplist", () => {
    it("does not check stoplist words even though they are capitalized and absent from the source", () => {
      const script = "However the buoy ran for 187 days. Meanwhile it worked. According to the team it is cheap. Today it floats.";
      expect(checkGrounding(script, buoy, MONDAY)).toEqual({ passed: true, missing: [] });
    });

    it("still checks capitalized words that are not on the stoplist", () => {
      const res = checkGrounding("Zorbax built the buoy.", buoy, MONDAY);
      expect(res.missing).toEqual(["Zorbax"]);
    });
  });

  describe("Template_Text", () => {
    // checkGrounding applies only to the story script. Intro/outro Template_Text is never passed to it,
    // because the pipeline composes it separately; names in it need not appear in any source.
    it("is the caller's responsibility: only the story script is passed, so template names are never checked", () => {
      const storyScript = "The buoy ran for 187 days.";
      const template = "Good morning from Hollowgate Radio, with host Barnaby Quill.";
      expect(checkGrounding(storyScript, buoy, MONDAY).passed).toBe(true);
      // Passing the template through would (wrongly) fail; this documents why it must not be.
      expect(checkGrounding(template, buoy, MONDAY).passed).toBe(false);
    });
  });
});
