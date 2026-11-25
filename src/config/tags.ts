/** Known_Tag_Set: HTML tag names the Tag_Stripper recognizes (lowercase tag names). */
export const KNOWN_TAG_SET: ReadonlySet<string> = new Set([
  "p", "div", "br", "a", "em", "strong", "b", "i", "code", "span", "sub", "sup",
  "cite", "img", "iframe", "center", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "table", "tr", "td", "th", "svg", "path", "g",
  "script", "style", "section", "article", "figure", "figcaption",
]);

/** Block_Tag_Set: tags that become a paragraph break; must be a subset of KNOWN_TAG_SET (lowercase tag names). */
export const BLOCK_TAG_SET: ReadonlySet<string> = new Set([
  "p", "div", "br", "li", "ol", "ul",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "tr", "td", "th", "table", "blockquote", "section", "article", "figure",
  "figcaption", "center",
]);
