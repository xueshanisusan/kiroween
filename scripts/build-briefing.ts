/**
 * Cron entry point for the briefing pipeline.
 *
 * Schedule: every 20 minutes, e.g. crontab `*\/20 * * * * npm run build-briefing`
 * (the pipeline's lock and Selected_Set comparison make overlapping or repeated ticks safe).
 *
 * Environment:
 *   LLM_MODE                             'http' (default) or 'kiro-cli'; unknown value exits 1
 *   LLM_API_KEY, LLM_API_URL, LLM_MODEL  LLM adapter for http mode (read by createEnvLlmAdapter)
 *   TTS_ENGINE                           'piper' (default, no credentials) or 'seed'
 *   BRIEFING_DATA_DIR                    Episode and lock directory (default: ./data)
 *
 * Exit codes: 0 for published, unchanged, skipped-locked and no-briefing; 1 for failed.
 * Secrets are never logged: only the outcome status, stage and reason code are written.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BRIEFING_DEFAULT_DATA_DIR } from "../src/config/index.js";
import { createHttpClient, type HttpClient } from "../src/lib/http.js";
import { createLogger } from "../src/lib/log.js";
import { runPipeline } from "../src/pipeline/run.js";
import { createKiroCliAdapter } from "../src/summarize/kiro-cli-adapter.js";
import { createEnvLlmAdapter } from "../src/summarize/llm.js";
import { selectLlmAdapter } from "../src/summarize/select-llm.js";
import { selectTtsAdapter, type ProcessRunner } from "../src/tts/tts.js";

/** Injectable collaborators; every field defaults to the real one. Tests override them. */
export interface BuildBriefingDeps {
  env?: Record<string, string | undefined>;
  http?: HttpClient;
  runPipeline?: typeof runPipeline;
  /** Process runner handed to the Kiro CLI adapter. Defaults to the real spawn runner. */
  runner?: ProcessRunner;
  stderr?: { write(text: string): unknown };
}

export async function main(deps: BuildBriefingDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const run = deps.runPipeline ?? runPipeline;
  const stderr = deps.stderr ?? process.stderr;
  const logger = createLogger();
  const dir = resolve(env.BRIEFING_DATA_DIR ?? BRIEFING_DEFAULT_DATA_DIR);

  const http = deps.http ?? createHttpClient();
  const llm = selectLlmAdapter(env.LLM_MODE, {
    http: () => createEnvLlmAdapter(http, env),
    kiroCli: () => createKiroCliAdapter(deps.runner ? { runner: deps.runner } : {}),
  });
  if (!llm.ok) {
    stderr.write(`build-briefing: ${llm.error.message}\n`);
    return 1;
  }

  mkdirSync(dir, { recursive: true });

  const tts = selectTtsAdapter(env.TTS_ENGINE);
  if (!tts.ok) {
    stderr.write(`build-briefing: ${tts.error.message}\n`);
    return 1;
  }

  const outcome = await run({
    http,
    llm: llm.value,
    tts: tts.value,
    clock: () => new Date(),
    dir,
    logger,
    lockPath: join(dir, ".build.lock"),
  });

  return outcome.status === "failed" ? 1 : 0;
}

// Run only when executed directly, so tests can import `main` without side effects.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
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
}
