import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAMED_ENTITIES } from "../config/entities.js";
import { decodeEntities, normalize } from "./normalize.js";

/** Extract raw content:encoded bodies, resolving the XML layer (CDATA or escaped) once. */
function extractBodies(xml: string): string[] {
  const bodies: string[] = [];
  const re = /<content:encoded>([\s\S]*?)<\/content:encoded>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1] as string;
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw);
    if (cdata) {
      bodies.push(cdata[1] as string);
    } else {
      const xmlEntities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
      bodies.push(raw.replace(/&(lt|gt|amp|quot|apos);/g, (_, n: string) => xmlEntities[n] as string));
    }
  }
  return bodies;
}

describe("decodeEntities: pinned table", () => {
  for (const [name, ch] of Object.entries(NAMED_ENTITIES)) {
    it(`&${name}; decodes to its mapped character`, () => {
      const r = decodeEntities(`a&${name};b`);
      expect(r.text).toBe(`a${ch}b`);
      expect(r.unrecognisedEntities).toEqual([]);
      expect(r.invalidNumericRefs).toEqual([]);
    });
  }

  it("decodes valid decimal and hex numeric references", () => {
    expect(decodeEntities("&#65;&#x42;&#X43;").text).toBe("ABC");
  });
});

describe("decodeEntities: unknown and invalid references", () => {
  it("preserves an unknown named reference and reports it once", () => {
    const r = decodeEntities("x &foo; y");
    expect(r.text).toBe("x &foo; y");
    expect(r.unrecognisedEntities).toEqual(["foo"]);
  });

  for (const ref of ["&#0;", "&#xD800;", "&#x110000;"]) {
    it(`preserves and reports invalid numeric reference ${ref}`, () => {
      const r = decodeEntities(`a${ref}b`);
      expect(r.text).toBe(`a${ref}b`);
      expect(r.invalidNumericRefs).toEqual([ref]);
    });
  }

  it("&amp;lt; decodes to &lt; and no further", () => {
    const r = decodeEntities("&amp;lt;");
    expect(r.text).toBe("&lt;");
    expect(r.unrecognisedEntities).toEqual([]);
  });
});

describe("normalize", () => {
  it("&lt;b&gt; yields the literal text <b>", () => {
    expect(normalize("&lt;b&gt;").sourceText).toBe("<b>");
  });

  it("&nbsp;, &#160; and raw U+00A0 collapse identically", () => {
    const a = normalize("one&nbsp;two").sourceText;
    const b = normalize("one&#160;two").sourceText;
    const c = normalize("one\u00A0two").sourceText;
    expect(a).toBe("one two");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("fixture items: img caption/alt dropped, entity-decoded text kept", () => {
    const xml = readFileSync(new URL("../../content/fixtures/synthetic-3-items.xml", import.meta.url), "utf8");
    const bodies = extractBodies(xml);
    expect(bodies).toHaveLength(3);
    const texts = bodies.map((b) => normalize(b).sourceText);

    const captions = [
      "The prototype buoy during sea trials",
      "Students attend a morning lecture",
      "Reel-to-reel tapes from the Thornquist collection",
    ];
    const alts = ["A yellow buoy floating", "Students seated in a large lecture hall", "Shelves of labeled"];
    texts.forEach((t, i) => {
      expect(t).not.toContain(captions[i] as string);
      expect(t).not.toContain(alts[i] as string);
      expect(t).not.toContain("<img");
      expect(t).not.toMatch(/&(ldquo|rdquo|mdash|amp|nbsp|rsquo);/);
    });

    expect(texts[0]).toContain("\u201CMost desalination plants");
    expect(texts[0]).toContain("never stop \u2014 so we");
    expect(texts[0]).toContain("research & development partners");
    expect(texts[1]).toContain("Learning & Memory Quarterly");
    expect(texts[1]).toContain("campus health offices \u2014 and");
    expect(texts[2]).toContain("library\u2019s head of preservation");
    expect(texts[2]).toContain("sound & wildlife enthusiasts");
  });
});
