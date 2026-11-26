import { CAMPUS_NAME, CAMPUS_TIMEZONE, GREETING_TEXT } from "../config/index.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Outro Template_Text, 15 words (matches OUTRO_WORDS). */
export const OUTRO_TEXT = "That is your briefing for today. Thanks for listening, and we will be back tomorrow.";

export type IntroParams = {
  /** Number of Survivors, 1 to 3. */
  survivorCount: number;
  /** Build instant; the spoken date is its calendar date in `timeZone`. */
  now: Date;
  /** Covered dates (YYYY-MM-DD) from the Selector; non-empty only when it widened. */
  coveredDates?: string[];
  campusName?: string;
  greeting?: string;
  timeZone?: string;
};

function spokenDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

function spokenCoveredDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const month = MONTHS[Number(m[2]) - 1];
  return month === undefined ? ymd : `${month} ${Number(m[3])}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const COUNT_WORDS: Record<number, string> = { 1: "one story", 2: "two stories", 3: "three stories" };

/**
 * Builds the intro Template_Text. States outlet and date once (9.2). Uses the
 * "short briefing today" wording for 1 or 2 Survivors (6.4). Adds covered dates when
 * the Selector widened (9.3). Without covered dates it is 20 words (INTRO_WORDS).
 */
export function buildIntro(params: IntroParams): string {
  const campus = params.campusName ?? CAMPUS_NAME;
  const greeting = params.greeting ?? GREETING_TEXT;
  const date = spokenDate(params.now, params.timeZone ?? CAMPUS_TIMEZONE);
  const head = `${greeting}. This is the ${campus} briefing for ${date}.`;
  const body =
    params.survivorCount < 3
      ? `It is a short briefing today, with ${COUNT_WORDS[params.survivorCount] ?? `${params.survivorCount} stories`}.`
      : "Here are today's top three stories from around campus.";
  const covered = params.coveredDates ?? [];
  const dates =
    covered.length > 0 ? ` These stories are from ${joinList(covered.map(spokenCoveredDate))}.` : "";
  return `${head} ${body}${dates}`;
}

/** Concatenates intro, Story_Scripts in the given (selection) order, and outro (9.1). */
export function assembleScript(intro: string, storyScripts: string[], outro: string = OUTRO_TEXT): string {
  return [intro, ...storyScripts, outro].join("\n\n");
}
