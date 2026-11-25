import { describe, expect, it } from "vitest";
import { normalize, stripTags } from "./normalize.js";

describe("stripTags literal regressions", () => {
  it("<<b>b> gives <b>", () => {
    expect(stripTags("<<b>b>").text).toBe("<b>");
  });

  it("block boundaries become a single space through normalize", () => {
    expect(normalize("<p>end.</p><p>Next</p>").sourceText).toBe("end. Next");
  });

  it("drops script contents between paragraphs", () => {
    const { sourceText } = normalize("<p>a</p><script>var x = 1;</script><p>b</p>");
    expect(sourceText).toBe("a b");
    expect(sourceText).not.toContain("var x");
  });

  it("leaves x<y and y>z unchanged and reports y as unknown", () => {
    const r = stripTags("x<y and y>z");
    expect(r.text).toBe("x<y and y>z");
    expect(r.unknownTagNames).toEqual(["y"]);
  });
});

describe("stripTags unclosed elements", () => {
  it("unclosed script drops to end of input", () => {
    const r = stripTags("keep<script>var x = 1; more");
    expect(r.text).toBe("keep");
    expect(r.unclosedElements).toEqual([{ name: "script", offset: 4 }]);
  });

  it("unclosed style drops to end of input", () => {
    const r = stripTags("hi <style>p{}");
    expect(r.text).toBe("hi ");
    expect(r.unclosedElements).toEqual([{ name: "style", offset: 3 }]);
  });

  it("unclosed comment drops to end of input", () => {
    const r = stripTags("ab<!-- never ends");
    expect(r.text).toBe("ab");
    expect(r.unclosedElements).toEqual([{ name: "comment", offset: 2 }]);
  });
});

describe("stripTags quote-aware tag end", () => {
  it("does not end a tag at > inside quotes", () => {
    expect(stripTags('<img data-caption="a > b">text').text).toBe("text");
  });

  it("treats < as literal when a quote is unterminated", () => {
    const r = stripTags('<img alt="oops>text');
    expect(r.text).toBe('<img alt="oops>text');
  });
});

describe("stripTags script, style and comment removal", () => {
  it("leaves no trace and no extra space", () => {
    expect(stripTags("a<script>x()</script>b").text).toBe("ab");
    expect(stripTags("a<style>p{}</style>b").text).toBe("ab");
    expect(stripTags("a<!-- note -->b").text).toBe("ab");
  });
});

describe("stripTags case and literal angle brackets", () => {
  it("matches tag names case-insensitively", () => {
    expect(stripTags("a<SCRIPT>x</Script>b").text).toBe("ab");
    expect(normalize("<P>one</P><P>two</P>").sourceText).toBe("one two");
  });

  it("leaves 5 < 6 unchanged", () => {
    const r = stripTags("5 < 6");
    expect(r.text).toBe("5 < 6");
    expect(r.unknownTagNames).toEqual([]);
  });
});
