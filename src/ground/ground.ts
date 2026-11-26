import { NUMBER_LEXICON, SENTENCE_STARTER_STOPLIST } from "../config/grounding.js";

export type Token = { kind: "number" | "date" | "name"; raw: string; normalized: string };
export type GroundingResult = { passed: boolean; missing: string[] };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_ALIASES: Record<string, string> = { sept: "september" };
const WEEKDAYS: ReadonlySet<string> = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const LEXICON_VALUE: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80",
  ninety: "90", hundred: "100", thousand: "1000", million: "1000000",
};

/** Canonical (full lowercase) month name for a month word or abbreviation, else undefined. */
function canonicalMonth(word: string): string | undefined {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (MONTH_ALIASES[w]) return MONTH_ALIASES[w];
  for (const m of MONTHS) {
    if (m === w) return m;
    if (w.length === 3 && m.startsWith(w)) return m;
  }
  return undefined;
}

const MONTH_PATTERN =
  "(?:january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";
const DATE_MD = new RegExp(
  `(?<![\\p{L}\\p{N}])(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{L}\\p{N}])(?:,?\\s+(\\d{4})(?![\\p{L}\\p{N}]))?`,
  "giu",
);
const DATE_DM = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})(?![\\p{L}])\\.?(?:,?\\s+(\\d{4})(?![\\p{L}\\p{N}]))?`,
  "giu",
);
const DIGIT_NUMBER = /[$€£¥]?(\d+(?:,\d{3})*(?:\.\d+)?)(?:(?:st|nd|rd|th)(?!\p{L}))?/gu;
const WORD = /\p{L}[\p{L}'’]*/gu;

function dateToken(raw: string, month: string, day: string, year?: string): Token | undefined {
  const m = canonicalMonth(month);
  const d = Number(day);
  if (!m || d < 1 || d > 31) return undefined;
  return { kind: "date", raw, normalized: `${m}-${d}${year ? `-${year}` : ""}` };
}

/** Extract month+day(+year) dates; returns the tokens and the text with matched spans masked by '#'. */
function extractDates(text: string): { tokens: Token[]; masked: string } {
  const tokens: Token[] = [];
  let masked = text;
  const mask = (start: number, len: number) => {
    masked = masked.slice(0, start) + "#".repeat(len) + masked.slice(start + len);
  };
  for (const re of [DATE_MD, DATE_DM]) {
    re.lastIndex = 0;
    const source = masked;
    for (const m of source.matchAll(re)) {
      const [raw, a, b, year] = m;
      const tok = re === DATE_MD ? dateToken(raw, a!, b!, year) : dateToken(raw, b!, a!, year);
      if (!tok) continue;
      if (/#/.test(raw)) continue;
      tokens.push({ ...tok, raw: raw.trim() });
      mask(m.index!, raw.length);
    }
  }
  return { tokens, masked };
}

function extractNumbers(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(DIGIT_NUMBER)) {
    out.push({ kind: "number", raw: m[0], normalized: m[1]!.replace(/,/g, "") });
  }
  for (const m of text.matchAll(WORD)) {
    const lw = m[0].toLowerCase();
    if (NUMBER_LEXICON.has(lw)) {
      out.push({ kind: "number", raw: m[0], normalized: LEXICON_VALUE[lw] ?? lw });
    }
  }
  return out;
}

function stripPossessive(word: string): string {
  return word.replace(/['’]s$/i, "");
}

/** Extract Checked_Tokens (numbers, dates, weekdays, capitalized-word runs) from a Story_Script. */
export function extractTokens(script: string, _pubDateWeekday: string): Token[] {
  const { tokens: dates, masked } = extractDates(script);
  const tokens: Token[] = [...dates];

  // Numbers: digits first, then mask them so names/gaps are not confused by them.
  const digitTokens: Token[] = [];
  let work = masked;
  for (const m of masked.matchAll(DIGIT_NUMBER)) {
    digitTokens.push({ kind: "number", raw: m[0], normalized: m[1]!.replace(/,/g, "") });
    work = work.slice(0, m.index!) + "#".repeat(m[0].length) + work.slice(m.index! + m[0].length);
  }
  tokens.push(...digitTokens);

  let run: { words: string[]; end: number } | undefined;
  const flush = () => {
    if (run) {
      const raw = run.words.join(" ");
      tokens.push({ kind: "name", raw, normalized: raw.toLowerCase() });
      run = undefined;
    }
  };

  for (const m of work.matchAll(WORD)) {
    const start = m.index!;
    const word = stripPossessive(m[0]);
    const lw = word.toLowerCase();
    const end = start + m[0].length;

    if (WEEKDAYS.has(lw)) {
      flush();
      tokens.push({ kind: "date", raw: m[0], normalized: lw });
      continue;
    }
    if (NUMBER_LEXICON.has(lw)) {
      flush();
      tokens.push({ kind: "number", raw: m[0], normalized: LEXICON_VALUE[lw] ?? lw });
      continue;
    }
    const isCap = /^\p{Lu}/u.test(word);
    if (isCap && canonicalMonth(word) && !SENTENCE_STARTER_STOPLIST.has(word)) {
      flush();
      tokens.push({ kind: "date", raw: m[0], normalized: canonicalMonth(word)! });
      continue;
    }
    if (!isCap || SENTENCE_STARTER_STOPLIST.has(word)) {
      flush();
      continue;
    }
    if (run && /^\s+$/.test(work.slice(run.end, start))) {
      run.words.push(word);
      run.end = end;
    } else {
      flush();
      run = { words: [word], end };
    }
  }
  flush();
  return tokens;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check that every number, date and name in `script` appears in `sourceText`. Pure. */
export function checkGrounding(
  script: string,
  sourceText: string,
  pubDateWeekday: string,
): GroundingResult {
  const tokens = extractTokens(script, pubDateWeekday);
  const pubWeekday = pubDateWeekday.trim().toLowerCase();

  const sourceNumbers = new Set(extractNumbers(sourceText).map((t) => t.normalized));
  const { tokens: sourceDates } = extractDates(sourceText);
  const sourceMonths = new Set<string>();
  for (const d of sourceDates) sourceMonths.add(d.normalized.split("-")[0]!);
  const sourceWeekdays = new Set<string>();
  for (const m of sourceText.matchAll(WORD)) {
    const w = stripPossessive(m[0]);
    const lw = w.toLowerCase();
    if (WEEKDAYS.has(lw)) sourceWeekdays.add(lw);
    else if (/^\p{Lu}/u.test(w) && canonicalMonth(w)) sourceMonths.add(canonicalMonth(w)!);
  }

  const missing: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    let found: boolean;
    if (t.kind === "number") {
      found = sourceNumbers.has(t.normalized);
    } else if (t.kind === "name") {
      const pattern = t.normalized.split(/\s+/).map(escapeRegExp).join("\\s+");
      found = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(sourceText);
    } else if (WEEKDAYS.has(t.normalized)) {
      found = t.normalized === pubWeekday || sourceWeekdays.has(t.normalized);
    } else {
      const parts = t.normalized.split("-");
      if (parts.length === 1) {
        found = sourceMonths.has(parts[0]!);
      } else {
        found = sourceDates.some((s) => {
          const sp = s.normalized.split("-");
          return sp[0] === parts[0] && sp[1] === parts[1] && (parts[2] === undefined || sp[2] === parts[2]);
        });
      }
    }
    if (!found) {
      const key = `${t.kind}:${t.normalized}`;
      if (!seen.has(key)) {
        seen.add(key);
        missing.push(t.raw);
      }
    }
  }
  return { passed: missing.length === 0, missing };
}
