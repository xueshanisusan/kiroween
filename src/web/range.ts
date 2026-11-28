export type SatisfiableRange = { kind: 'satisfiable'; start: number; end: number };
export type UnsatisfiableRange = { kind: 'unsatisfiable' };
export type NotARange = { kind: 'not-a-range' };
export type RangeResult = SatisfiableRange | UnsatisfiableRange | NotARange;

const PREFIX = 'bytes=';
const UNSATISFIABLE: UnsatisfiableRange = { kind: 'unsatisfiable' };
const DIGITS = /^\d+$/;

function parseNumber(text: string): number | undefined {
  if (!DIGITS.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Parse a `Range` header value against a file size in bytes. */
export function parseRange(headerValue: string | undefined, sizeBytes: number): RangeResult {
  if (headerValue === undefined || !headerValue.startsWith(PREFIX)) {
    return { kind: 'not-a-range' };
  }
  const spec = headerValue.slice(PREFIX.length).trim();
  if (spec.includes(',')) return UNSATISFIABLE;

  const dash = spec.indexOf('-');
  if (dash < 0 || spec.indexOf('-', dash + 1) >= 0) return UNSATISFIABLE;
  const startText = spec.slice(0, dash).trim();
  const endText = spec.slice(dash + 1).trim();

  if (startText === '') {
    // Suffix form: last `length` bytes.
    const length = parseNumber(endText);
    if (length === undefined || length === 0 || sizeBytes <= 0) return UNSATISFIABLE;
    return {
      kind: 'satisfiable',
      start: Math.max(0, sizeBytes - length),
      end: sizeBytes - 1,
    };
  }

  const start = parseNumber(startText);
  if (start === undefined) return UNSATISFIABLE;

  if (endText === '') {
    if (start >= sizeBytes) return UNSATISFIABLE;
    return { kind: 'satisfiable', start, end: sizeBytes - 1 };
  }

  const end = parseNumber(endText);
  if (end === undefined || start > end || start >= sizeBytes) return UNSATISFIABLE;
  return { kind: 'satisfiable', start, end: Math.min(end, sizeBytes - 1) };
}

/** Format a byte range as a `Range` header value. */
export function formatRange(range: { start: number; end: number }): string {
  return `${PREFIX}${range.start}-${range.end}`;
}
