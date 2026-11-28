/** Campus name used in the spoken intro (text). */
export const CAMPUS_NAME = "MIT";

/** RSS feed URLs for the campus (URL strings). */
export const FEED_URLS = ["https://news.mit.edu/rss/feed"] as const;

/** Campus timezone used to decide what "today" is (IANA timezone name). */
export const CAMPUS_TIMEZONE = "America/New_York";

/** TTS voice id: the Piper voice name, also the model file's base name (text). */
export const VOICE_ID = "en_US-ryan-high";

/** Pause Piper inserts after each sentence (seconds). Piper default is 0.2; 0.7 sounded too slow. */
export const TTS_SENTENCE_SILENCE_SECONDS = 0.3;

/** ffmpeg audio filter chain (-af) giving the radio-style sound for phone speakers (ffmpeg filtergraph text). */
export const TTS_RADIO_FILTER =
  "highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=4,aecho=0.8:0.5:45:0.25,volume=1.3";

/** Supported TTS engines (text identifiers). */
export type TtsEngine = "piper" | "seed";

/** Selected TTS engine: 'piper' (default; tests and local, no credentials) or 'seed' (production). Read from TTS_ENGINE; unset means piper. Left as text so an unknown value is reported by selectTtsAdapter. */
export const TTS_ENGINE: string = process.env.TTS_ENGINE ?? "piper";

/** Per-engine ffmpeg -af filter chain (ffmpeg filtergraph text). An empty string means no -af argument. */
export const TTS_ENGINE_FILTERS: Record<TtsEngine, string> = {
  piper: TTS_RADIO_FILTER,
  seed: "",
};

/** OpenRouter model id for Seed TTS (text). Override with SEED_TTS_MODEL. */
export const SEED_TTS_MODEL: string = process.env.SEED_TTS_MODEL ?? "bytedance-seed/seed-audio-1-0";

/**
 * Seed speaker id (text, provider-specific). OPEN QUESTION in product.md: deliberately NOT guessed.
 * Empty by default, meaning no voice is sent; set SEED_TTS_VOICE after the listening test.
 */
export const SEED_TTS_VOICE: string = process.env.SEED_TTS_VOICE ?? "";

/** Timeout for one Seed TTS request (milliseconds). */
export const SEED_TTS_TIMEOUT_MS = 60_000;

/** Piper executable, looked up on PATH (command name or absolute path). */
export const PIPER_BINARY = "piper";

/** ffmpeg executable, looked up on PATH (command name or absolute path). */
export const FFMPEG_BINARY = "ffmpeg";

/** Directory holding Piper voice models; the model is `<dir>/<voice id>.onnx` (directory path). */
export const PIPER_VOICE_MODEL_DIR = "models/piper";

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

/** Timeout for one voice model download by scripts/fetch-voice.ts (milliseconds). The high-quality model is about 120 MB. */
export const VOICE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** Hugging Face base URL of the Piper voices repository (URL, no trailing slash). */
export const PIPER_VOICES_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** Default directory for episode files and the build lock (directory path). Overridden by BRIEFING_DATA_DIR; shared by the build script and the web server. */
export const BRIEFING_DEFAULT_DATA_DIR = "./data";

/** Web player settings (Requirement 9.1). */
export type WebConfig = {
  /** Outlet name shown on the page (text). */
  outletName: string;
  /** Page title (text). */
  pageTitle: string;
  /** Message shown when no briefing is published (text). */
  emptyStateMessage: string;
  /** Accessible label of the audio control (text). */
  audioLabel: string;
  /** Cache-Control max-age for episode JSON (seconds). */
  jsonCacheMaxAgeSeconds: number;
  /** Time allowed to receive request headers (milliseconds). */
  headerTimeoutMs: number;
  /** Idle socket timeout (milliseconds). */
  idleTimeoutMs: number;
};

export const WEB_CONFIG: WebConfig = {
  outletName: CAMPUS_NAME,
  pageTitle: `${CAMPUS_NAME} Briefing`,
  emptyStateMessage: "No briefing has been published yet. Check back soon.",
  audioLabel: `Play today's ${CAMPUS_NAME} briefing`,
  jsonCacheMaxAgeSeconds: 60, // seconds: short, since a new build can publish any time
  headerTimeoutMs: 10_000, // milliseconds
  idleTimeoutMs: 30_000, // milliseconds
};

/** Default web server port (number, 1-65535), overridden by PORT. */
export const WEB_DEFAULT_PORT = 8787;

/** Default web server bind host (IPv4 address), overridden by HOST. */
export const WEB_DEFAULT_HOST = "0.0.0.0";
