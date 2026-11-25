import { LENGTH_BUDGET_WORDS, MIN_SCRIPT_WORDS } from "../config/index.js";

/** Counts whitespace-separated words. Empty or whitespace-only text gives 0. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

/** True iff MIN_SCRIPT_WORDS <= totalWords <= the Length_Budget for the story count. */
export function isAcceptableLength(
  totalWords: number,
  finalStoryCount: 1 | 2 | 3,
): boolean {
  return (
    totalWords >= MIN_SCRIPT_WORDS &&
    totalWords <= LENGTH_BUDGET_WORDS[finalStoryCount]
  );
}
