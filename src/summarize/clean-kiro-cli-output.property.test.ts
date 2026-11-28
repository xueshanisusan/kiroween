import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PROPERTY_TEST_RUNS } from "../config/index.js";

import { cleanKiroCliOutput } from "./clean-kiro-cli-output.js";

const ESC = "\u001b";

/** CSI sequence: ESC [ params intermediates final. */
const csi = fc
  .tuple(
    fc.stringMatching(/^[0-9;?]{0,6}$/),
    fc.stringMatching(/^[ !"#$%&'()*+,\-./]{0,2}$/),
    fc.constantFrom("m", "K", "H", "J", "A", "B", "C", "D", "h", "l"),
  )
  .map(([params, inter, final]) => `${ESC}[${params}${inter}${final}`);

/** OSC sequence: ESC ] payload terminated by BEL or ESC \. */
const osc = fc
  .tuple(
    fc.stringMatching(/^[0-9a-zA-Z;:/._ -]{0,20}$/),
    fc.constantFrom("\u0007", `${ESC}\\`),
  )
  .map(([payload, term]) => `${ESC}]${payload}${term}`);

const ansi = fc.oneof(csi, osc);
const lineEnding = fc.constantFrom("\r", "\r\n", "\n");
const text = fc.string({ maxLength: 30 });

const noisy = fc
  .array(fc.oneof(text, ansi, lineEnding), { maxLength: 40 })
  .map((parts) => parts.join(""));

// Feature: kiro-cli-llm-mode, Property 1: Output_Cleaner removes all ANSI sequences and carriage returns
describe("cleanKiroCliOutput property 1: ANSI and carriage-return removal", () => {
  it("**Validates: Requirements 3.2, 3.6, 3.7** leaves no escape character and no \\r", () => {
    fc.assert(
      fc.property(noisy, (raw) => {
        const cleaned = cleanKiroCliOutput(raw);
        expect(cleaned).not.toContain(ESC);
        expect(cleaned).not.toContain("\r");
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          [`${ESC}[31mred${ESC}[0m\r\nline\r`],
          [`${ESC}]0;title\u0007hello\rworld`],
          [`> reply${ESC}[2K\r\n`],
        ],
      },
    );
  });
});

const markers = fc.constantFrom(
  "> ",
  ">",
  "> > ",
  "[tool call]",
  "[tool result] ok",
  "[denied]",
  "🛠 run",
  "● done",
  "<tool_use>",
  "</tool_use>",
  "<tool_result>",
  "</tool_result>",
  "<tool_use>\nbody\n</tool_use>",
  "<tool_result>x</tool_result>",
);

const markerNoisy = fc
  .array(fc.oneof(text, ansi, lineEnding, markers), { maxLength: 40 })
  .map((parts) => parts.join(""));

// Feature: kiro-cli-llm-mode, Property 2: Output_Cleaner is idempotent
describe("cleanKiroCliOutput property 2: idempotence", () => {
  it("**Validates: Requirements 3.8** clean(clean(s)) === clean(s)", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), noisy, markerNoisy), (raw) => {
        const once = cleanKiroCliOutput(raw);
        expect(cleanKiroCliOutput(once)).toBe(once);
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          ["> > x"],
          ["plain reply"],
          [""],
          ["> [tool x]\n> reply"],
          ["<tool_use>\n> a\n</tool_use>\n> b"],
          [`${ESC}[31m> ${ESC}[0m● x\n> hi`],
        ],
      },
    );
  });
});

/** Plain reply characters: no ESC, no `>` marker, no `<` tags, no `[` tool prefix, no 🛠 or ●. */
const PLAIN_ALPHABET = "abcXYZ019 \t.,;:!?'\"-()";
const plainLine = fc
  .array(fc.constantFrom(...PLAIN_ALPHABET.split("")), { maxLength: 30 })
  .map((chars) => chars.join(""));

const plainText = fc
  .tuple(
    plainLine,
    fc.array(fc.tuple(lineEnding, plainLine), { maxLength: 10 }),
  )
  .map(([first, rest]) => {
    const raw = first + rest.map(([eol, line]) => eol + line).join("");
    // Adjacent \r and \n endings can merge into \r\n, so normalize the joined text.
    return { raw, expected: raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() };
  });

// Feature: kiro-cli-llm-mode, Property 3: Output_Cleaner is the identity on plain reply text
describe("cleanKiroCliOutput property 3: identity on plain reply text", () => {
  it("**Validates: Requirements 3.9** equals the input with \\n line endings, trimmed", () => {
    fc.assert(
      fc.property(plainText, ({ raw, expected }) => {
        expect(cleanKiroCliOutput(raw)).toBe(expected);
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          [{ raw: "line one\r\nline two\rline three", expected: "line one\nline two\nline three" }],
          [{ raw: "  padded  \n\n", expected: "padded" }],
        ],
      },
    );
  });
});

/** Whole-line noise the cleaner documents as removable: tool-use lines and embedded tool blocks. */
const toolBody = plainLine.filter((l) => !l.includes("<"));
const toolNoiseBlock = fc.oneof(
  fc.constantFrom("[tool call]", "[tool result] ok", "[denied]", "🛠 run", "● done").map((l) => [l]),
  toolBody.map((b) => ["<tool_use>", b, "</tool_use>"]),
  toolBody.map((b) => ["<tool_result>", b, "</tool_result>"]),
  toolBody.map((b) => [`<tool_use>${b}</tool_use>`]),
);

/** Leading preamble: blank lines and single-line tool markers only (the cleaner's leading chrome). */
const preamble = fc.array(
  fc.oneof(fc.constant(""), fc.constant("   "), fc.constantFrom("[tool call]", "[denied]", "🛠 run", "● done")),
  { maxLength: 4 },
);

const noisyPlain = fc
  .tuple(
    plainText,
    preamble,
    // Per text line: tool blocks inserted before it, and ANSI codes before/after it.
    fc.array(
      fc.tuple(fc.array(toolNoiseBlock, { maxLength: 2 }), fc.array(ansi, { maxLength: 2 }), fc.array(ansi, { maxLength: 2 })),
      { minLength: 12, maxLength: 12 },
    ),
    fc.array(toolNoiseBlock, { maxLength: 2 }),
  )
  .map(([{ raw }, pre, perLine, trailing]) => {
    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const out: string[] = [...pre];
    lines.forEach((line, i) => {
      const [blocks, before, after] = perLine[i] as [string[][], string[], string[]];
      for (const block of blocks) out.push(...block);
      out.push(before.join("") + line + after.join(""));
    });
    for (const block of trailing) out.push(...block);
    return { clean: raw, noisy: out.join("\n") };
  });

// Feature: kiro-cli-llm-mode, Property 4: Output_Cleaner is metamorphically stable under added noise
describe("cleanKiroCliOutput property 4: metamorphic stability under added noise", () => {
  it("**Validates: Requirements 3.10** clean(noisy) === clean(t)", () => {
    fc.assert(
      fc.property(noisyPlain, ({ clean, noisy: noisyText }) => {
        expect(cleanKiroCliOutput(noisyText)).toBe(cleanKiroCliOutput(clean));
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          [{ clean: "hello\nworld", noisy: `[tool call]\n\n<tool_use>\nx\n</tool_use>\n${ESC}[1mhello${ESC}[0m\n[denied]\nworld` }],
        ],
      },
    );
  });
});

/** Removable-only vocabulary: ANSI codes, preamble lines, tool-use lines/blocks and the reply marker. */
const removablePiece = fc.oneof(
  ansi,
  fc.constantFrom("", "   ", "\t"),
  fc.constantFrom("[tool call]", "[tool result] ok", "[denied]", "🛠 run", "● done"),
  fc.constantFrom(
    "<tool_use>\nbody\n</tool_use>",
    "<tool_result>x</tool_result>",
    "<tool_use>\n[tool call]\n</tool_use>",
  ),
  fc.constantFrom(">", "> "),
);

const allRemovable = fc
  .array(fc.tuple(removablePiece, fc.constantFrom("\n", "\r\n", "\r")), { maxLength: 30 })
  .map((pairs) => pairs.map(([piece, eol]) => piece + eol).join(""));

// Feature: kiro-cli-llm-mode, Property 5: Output_Cleaner collapses all-removable input to empty
describe("cleanKiroCliOutput property 5: all-removable input collapses to empty", () => {
  it("**Validates: Requirements 3.11** returns \"\" when nothing but removable text is present", () => {
    fc.assert(
      fc.property(allRemovable, (raw) => {
        expect(cleanKiroCliOutput(raw)).toBe("");
      }),
      {
        numRuns: PROPERTY_TEST_RUNS,
        examples: [
          [""],
          [">"],
          [`${ESC}[31m${ESC}[0m`],
          ["[tool call]\n\n> \n[denied]\n"],
          ["<tool_use>\nbody\n</tool_use>\n>\n"],
        ],
      },
    );
  });
});
