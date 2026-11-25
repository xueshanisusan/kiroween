import { NAMED_ENTITIES } from "../config/entities.js";
import { BLOCK_TAG_SET, KNOWN_TAG_SET } from "../config/tags.js";

export type TagStripResult = {
  text: string;
  unknownTagNames: string[];
  unclosedElements: { name: "script" | "style" | "comment"; offset: number }[];
};

const NAME_CHAR = /[A-Za-z0-9]/;

/** Reads '<', optional '/', then [A-Za-z0-9]+. Returns null if not tag-shaped. */
function readTagName(input: string, i: number): { name: string; closing: boolean; end: number } | null {
  let p = i + 1;
  const closing = input[p] === "/";
  if (closing) p++;
  const start = p;
  while (p < input.length && NAME_CHAR.test(input.charAt(p))) p++;
  if (p === start) return null;
  return { name: input.slice(start, p), closing, end: p };
}

/** Quote-aware search for the '>' ending a tag starting at i. Null if a quote is unterminated or a bare '<' / end is reached first. */
function findClosingAngle(input: string, i: number): number | null {
  for (let p = i + 1; p < input.length; p++) {
    const c = input[p];
    if (c === '"' || c === "'") {
      const q = input.indexOf(c, p + 1);
      if (q === -1) return null;
      p = q;
    } else if (c === "<") {
      return null;
    } else if (c === ">") {
      return p;
    }
  }
  return null;
}

/** Quote-aware search for `</name\s*>` from `from`. Returns the index just past the closing tag, or null. An unterminated quote is treated as a literal character. */
function findClosingTagEnd(input: string, from: number, name: string): number | null {
  const re = new RegExp(`^</${name}\\s*>`, "i");
  for (let p = from; p < input.length; p++) {
    const c = input[p];
    if (c === '"' || c === "'") {
      const q = input.indexOf(c, p + 1);
      if (q !== -1) p = q;
    } else if (c === "<") {
      const m = re.exec(input.slice(p, p + name.length + 16));
      if (m) return p + m[0].length;
    }
  }
  return null;
}

export function stripTags(input: string): TagStripResult {
  const out: string[] = [];
  const unknownTagNames: string[] = [];
  const unclosedElements: TagStripResult["unclosedElements"] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    if (input[i] !== "<") {
      out.push(input.charAt(i));
      i++;
      continue;
    }

    if (input.slice(i, i + 4) === "<!--") {
      const j = input.indexOf("-->", i + 4);
      if (j !== -1) {
        i = j + 3;
      } else {
        unclosedElements.push({ name: "comment", offset: i });
        i = len;
      }
      continue;
    }

    const tag = readTagName(input, i);
    if (tag === null) {
      out.push("<");
      i++;
      continue;
    }
    const lower = tag.name.toLowerCase();

    if (!tag.closing && (lower === "script" || lower === "style")) {
      const end = findClosingTagEnd(input, tag.end, lower);
      if (end !== null) {
        i = end;
      } else {
        unclosedElements.push({ name: lower, offset: i });
        i = len;
      }
      continue;
    }

    const closeAngle = findClosingAngle(input, i);
    if (closeAngle === null) {
      out.push("<");
      i++;
      continue;
    }

    if (KNOWN_TAG_SET.has(lower)) {
      if (BLOCK_TAG_SET.has(lower)) out.push(" ");
    } else {
      out.push(input.slice(i, closeAngle + 1));
      unknownTagNames.push(tag.name);
    }
    i = closeAngle + 1;
  }

  return { text: out.join(""), unknownTagNames, unclosedElements };
}

export type EntityDecodeResult = {
  text: string;
  unrecognisedEntities: string[];
  invalidNumericRefs: string[];
};

const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/y;

/** Single-pass entity decoder. Never re-scans its own output. */
export function decodeEntities(input: string): EntityDecodeResult {
  const out: string[] = [];
  const unrecognisedEntities: string[] = [];
  const invalidNumericRefs: string[] = [];
  let i = 0;

  while (i < input.length) {
    const amp = input.indexOf("&", i);
    if (amp === -1) {
      out.push(input.slice(i));
      break;
    }
    out.push(input.slice(i, amp));

    ENTITY_RE.lastIndex = amp;
    const m = ENTITY_RE.exec(input);
    if (m === null) {
      out.push("&");
      i = amp + 1;
      continue;
    }

    const literal = m[0];
    if (m[3] !== undefined) {
      const name = m[3];
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) {
        out.push(NAMED_ENTITIES[name] as string);
      } else {
        out.push(literal);
        unrecognisedEntities.push(name);
      }
    } else {
      const digits = m[1] ?? (m[2] as string);
      const cp = m[1] !== undefined ? parseInt(digits, 10) : parseInt(digits, 16);
      if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        out.push(literal);
        invalidNumericRefs.push(literal);
      } else {
        out.push(String.fromCodePoint(cp));
      }
    }
    i = amp + literal.length;
  }

  return { text: out.join(""), unrecognisedEntities, invalidNumericRefs };
}

const WHITESPACE_RUN_RE = /[ \t\n\r\f\v\u00A0]+/g;

/** Stage A2: collapse whitespace runs to a single space and trim. Idempotent. */
export function normalizeWhitespace(input: string): string {
  return input.replace(WHITESPACE_RUN_RE, " ").trim();
}

export type NormalizeReport = {
  sourceText: string;
  unknownTagNames: string[];
  unclosedElements: TagStripResult["unclosedElements"];
  unrecognisedEntities: string[];
  invalidNumericRefs: string[];
};

/** Source_Text = A2(B(A1(input))). Each stage runs exactly once; decoder output is never re-stripped. */
export function normalize(contentEncoded: string): NormalizeReport {
  const stripped = stripTags(contentEncoded);
  const decoded = decodeEntities(stripped.text);
  const sourceText = normalizeWhitespace(decoded.text);
  return {
    sourceText,
    unknownTagNames: stripped.unknownTagNames,
    unclosedElements: stripped.unclosedElements,
    unrecognisedEntities: decoded.unrecognisedEntities,
    invalidNumericRefs: decoded.invalidNumericRefs,
  };
}
