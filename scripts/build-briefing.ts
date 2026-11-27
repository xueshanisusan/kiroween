/**
 * Cron entry point for the briefing pipeline.
 *
 * Schedule: every 20 minutes, e.g. crontab `*\/20 * * * * npm run build-briefing`
 * (the pipeline's lock and Selected_Set comparison make overlapping or repeated ticks safe).
 *
 * Environment:
 *   LLM_API_KEY, LLM_API_URL, LLM_MODEL  LLM adapter (read by createEnvLlmAdapter)
 *   (TTS needs no credentials: local `piper` and `ffmpeg` binaries, see README)
 *   BRIEFING_DATA_DIR                    Episode and lock directory (default: ./data)
 *
 * Exit codes: 0 for published, unchanged, skipped-locked and no-briefing; 1 for failed.
 * Secrets are never logged: only the outcome status, stage and reason code are written.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHttpClient } from "../src/lib/http.js";
import { createLogger } from "../src/lib/log.js";
import { runPipeline } from "../src/pipeline/run.js";
import { createEnvLlmAdapter } from "../src/summarize/llm.js";
import { createLocalTtsAdapter } from "../src/tts/tts.js";

async function main(): Promise<number> {
  const logger = createLogger();
  const dir = resolve(process.env.BRIEFING_DATA_DIR ?? "data");
  mkdirSync(dir, { recursive: true });

  const http = createHttpClient();
  const outcome = await runPipeline({
    http,
    llm: createEnvLlmAdapter(http, process.env),
    tts: createLocalTtsAdapter(),
    clock: () => new Date(),
    dir,
    logger,
    lockPath: join(dir, ".build.lock"),
  });

  return outcome.status === "failed" ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // Message only: never dump the error object, which could carry request headers.
    process.stderr.write(`build-briefing crashed: ${e instanceof Error ? e.message : "unknown error"}\n`);
    process.exitCode = 1;
  },
);
