// Pure cleaner for `kiro-cli chat --no-interactive` stdout. No I/O, no clock, no randomness.

/** CSI sequences (colors, cursor movement) and OSC sequences (BEL or ST terminated). */
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
/** Any ESC left over (e.g. a truncated sequence) must not survive. */
const ANSI_STRAY_ESC = /\u001b/g;

/** A single-line tool-use / tool-result / denial marker. */
const TOOL_LINE = /^\s*(?:\[tool[^\]]*\]|\[denied\]|🛠|●)/;
/** Opening tag of a multi-line tool block, and the name of its closing tag. */
const TOOL_BLOCK_OPEN = /^\s*<(tool_use|tool_result)\b/;
/** Reply marker Kiro CLI prints before the reply text: a leading `>` with optional one space. */
const REPLY_MARKER = /^\s*>[ \t]?/;

function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(ANSI_STRAY_ESC, "");
}

function dropLeadingChrome(lines: string[]): string[] {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "" || TOOL_LINE.test(line)) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i);
}

function dropToolBlocks(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const open = TOOL_BLOCK_OPEN.exec(line);
    if (open) {
      const close = `</${open[1]}>`;
      // A closed block is removed whole; an unclosed opener removes only its own line.
      let end = -1;
      for (let j = i; j < lines.length; j += 1) {
        if ((lines[j] as string).includes(close)) {
          end = j;
          break;
        }
      }
      if (end >= 0) i = end;
      continue;
    }
    if (TOOL_LINE.test(line)) continue;
    out.push(line);
  }
  return out;
}

function stripReplyMarker(lines: string[]): string[] {
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) return lines;
  const rest = (lines[first] as string).replace(REPLY_MARKER, "");
  if (rest === (lines[first] as string)) return lines;
  return [...lines.slice(0, first), rest, ...lines.slice(first + 1)];
}

function cleanOnce(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const stripped = stripAnsi(normalized);
  let lines = stripped.split("\n");
  lines = dropLeadingChrome(lines);
  lines = dropToolBlocks(lines);
  lines = stripReplyMarker(lines);
  return lines.join("\n").trim();
}

/**
 * Turns raw Kiro CLI stdout into reply text. The pass only removes text, so it is repeated
 * until the output stops changing; that makes the function idempotent by construction
 * (for example `> > x` loses both markers rather than one on each call).
 */
export function cleanKiroCliOutput(raw: string): string {
  let current = raw;
  for (;;) {
    const next = cleanOnce(current);
    if (next === current) return next;
    current = next;
  }
}
