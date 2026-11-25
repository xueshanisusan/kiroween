/** Campus name used in the spoken intro (text). */
export const CAMPUS_NAME = "MIT";

/** RSS feed URLs for the campus (URL strings). */
export const FEED_URLS = ["https://news.mit.edu/rss/feed"] as const;

/** Campus timezone used to decide what "today" is (IANA timezone name). */
export const CAMPUS_TIMEZONE = "America/New_York";

/** TTS voice id (provider voice name, provisional: Amazon Polly neural voice). */
export const VOICE_ID = "Joanna";

/** Greeting spoken at the start of the intro (text). */
export const GREETING_TEXT = "Good morning";

/** Speaking rate used to estimate audio length (words per minute). */
export const SPEAKING_RATE_WPM = 150;

/** Story word target for pass 1, any story count (words). */
export const STORY_WORDS_PASS_1 = 85;

/** Story word target in pass 2 when 2 stories survive (words per story). */
export const STORY_WORDS_PASS_2_TWO_STORIES = 120;

/** Story word target in pass 2 when 1 story survives (words). */
export const STORY_WORDS_PASS_2_ONE_STORY = 165;

/** Fixed intro length (words). */
export const INTRO_WORDS = 20;

/** Fixed outro length (words). */
export const OUTRO_WORDS = 15;

/** Length_Budget: maximum total script words, keyed by final story count (words). */
export const LENGTH_BUDGET_WORDS = { 3: 290, 2: 275, 1: 200 } as const;

/** Minimum total script words for a script to be accepted (words). */
export const MIN_SCRIPT_WORDS = 150;

/** Minimum Source_Text length for an item to be usable (characters). */
export const TOO_THIN_THRESHOLD = 500;

/** Maximum number of stories in one episode (count). */
export const STORY_COUNT_CAP = 3;

/** Number of runs per property-based test (count). */
export const PROPERTY_TEST_RUNS = 100;

/** Retries for each outbound HTTP call after the first attempt (count). */
export const HTTP_RETRY_COUNT = 1;

/** Minimum duration of a published episode's audio (seconds). */
export const MIN_EPISODE_SECONDS = 60;

/** Total time allowed for one build (seconds). Must be at most 600. */
export const BUILD_BUDGET_SECONDS = 300;

/** Grace added to BUILD_BUDGET_SECONDS before a held build lock is stale (seconds). */
export const BUILD_LOCK_GRACE_SECONDS = 60;

/** Interval between cron invocations (seconds). */
export const CRON_INTERVAL_SECONDS = 1200;
