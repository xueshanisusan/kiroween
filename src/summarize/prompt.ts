/** All prompt text for the summarizer lives in this file. */

/** Number of opening sentences included verbatim in the prompt (count). */
export const OPENING_SENTENCE_COUNT = 3;

const IMPACT_CUES =
  /\b(could|will|would|enable[sd]?|improv\w*|reduc\w*|increas\w*|impact|help\w*|allow\w*|new|first|percent|%|million|billion)\b/i;

/** Splits normalized Source_Text into sentences (single-line text, so no paragraph marks remain). */
export function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** The opening of the article: its first sentences, standing in for the opening paragraphs. */
export function openingParagraphs(sourceText: string): string {
  return splitSentences(sourceText).slice(0, OPENING_SENTENCE_COUNT).join(" ");
}

/**
 * One impact sentence from the body (after the opening): the first sentence with an impact
 * cue, else the last body sentence. Empty string when the article has no body past the opening.
 */
export function impactSentence(sourceText: string): string {
  const body = splitSentences(sourceText).slice(OPENING_SENTENCE_COUNT);
  if (body.length === 0) return "";
  return body.find((s) => IMPACT_CUES.test(s)) ?? body[body.length - 1]!;
}

/** Builds the single prompt for one item and one pass. */
export function buildPrompt(sourceText: string, targetWords: number): string {
  const opening = openingParagraphs(sourceText);
  const impact = impactSentence(sourceText);
  return [
    `Write a spoken news story of about ${targetWords} words for a radio-style campus briefing.`,
    "Lead with what happened, using the opening of the article below. Then add why it matters, using the impact sentence.",
    "Use only facts, names, numbers and dates that appear in the material below. Do not add anything else.",
    "Do not state the outlet name or the date; the briefing intro does that. Name a source only when attributing a specific claim.",
    "Write plain spoken prose: no headings, lists or markup.",
    "",
    "OPENING OF THE ARTICLE:",
    opening,
    "",
    "IMPACT SENTENCE:",
    impact || "(none)",
  ].join("\n");
}
