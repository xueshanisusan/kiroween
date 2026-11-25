/** Sentence_Starter_Stoplist: words excluded from capitalized-word runs (exact, case-sensitive matches). */
export const SENTENCE_STARTER_STOPLIST: ReadonlySet<string> = new Set([
  "The", "This", "That", "It", "But", "And", "However", "Meanwhile", "According",
  "Today", "Yesterday", "Tomorrow", "still", "also", "now",
]);

/** Number_Lexicon: spelled-out numbers recognized as numeric claims (lowercase words; "one" is excluded). */
export const NUMBER_LEXICON: ReadonlySet<string> = new Set([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty",
  "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "million",
]);
