import {
  KIRO_CLI_BINARY,
  KIRO_CLI_NOT_LOGGED_IN_HINTS,
  KIRO_CLI_STDERR_EXCERPT_CHARS,
  KIRO_CLI_STDOUT_LIMIT_BYTES,
  KIRO_CLI_TIMEOUT_MS,
} from "../config/index.js";
import type { Logger } from "../lib/log.js";
import { createSpawnRunner } from "../tts/tts.js";
import type { ProcessRunner } from "../tts/tts.js";
import type { Result } from "../types.js";
import { cleanKiroCliOutput } from "./clean-kiro-cli-output.js";
import type { LlmAdapter, LlmError, LlmRequest } from "./llm.js";

export interface KiroCliAdapterOptions {
  /** Defaults to the real spawn runner. */
  runner?: ProcessRunner;
  /** Executable name or path. Defaults to KIRO_CLI_BINARY. */
  binary?: string;
  /** Run timeout (milliseconds). Defaults to KIRO_CLI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Cap on captured stdout (bytes). Defaults to KIRO_CLI_STDOUT_LIMIT_BYTES. */
  stdoutLimitBytes?: number;
  /** Length of stderr excerpt in error messages (characters). */
  stderrExcerptChars?: number;
  /** Case-insensitive stderr substrings meaning "not logged in". */
  notLoggedInHints?: readonly string[];
  /** Clock for duration logging only (milliseconds). Defaults to Date.now. */
  now?: () => number;
  /** Defaults to a no-op logger. */
  logger?: Pick<Logger, "info">;
}

const ENOENT_RE = /ENOENT|not found|no such file/i;

/** Runs `kiro-cli chat --no-interactive <prompt>` once per call. Never retries, never throws. */
export function createKiroCliAdapter(options: KiroCliAdapterOptions = {}): LlmAdapter {
  const runner = options.runner ?? createSpawnRunner();
  const binary = options.binary ?? KIRO_CLI_BINARY;
  const timeoutMs = options.timeoutMs ?? KIRO_CLI_TIMEOUT_MS;
  const stdoutLimit = options.stdoutLimitBytes ?? KIRO_CLI_STDOUT_LIMIT_BYTES;
  const excerptChars = options.stderrExcerptChars ?? KIRO_CLI_STDERR_EXCERPT_CHARS;
  const hints = (options.notLoggedInHints ?? KIRO_CLI_NOT_LOGGED_IN_HINTS).map((h) => h.toLowerCase());
  const now = options.now ?? Date.now;
  const logger = options.logger;

  return {
    async complete(req: LlmRequest): Promise<Result<string, LlmError>> {
      const startedAt = now();
      let exitStatus: number | string = "not-run";

      const finish = (error: LlmError): Result<string, LlmError> => {
        logger?.info("kiro-cli-complete", {
          exitStatus,
          durationMs: now() - startedAt,
          errorKind: error.kind,
        });
        return { ok: false, error };
      };

      if (req.signal.aborted) {
        exitStatus = "aborted";
        return finish({ kind: "aborted", message: "kiro-cli: aborted" });
      }

      const controller = new AbortController();
      let timedOut = false;
      const onCallerAbort = (): void => controller.abort();
      req.signal.addEventListener("abort", onCallerAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      let outcome: Awaited<ReturnType<ProcessRunner["run"]>>;
      try {
        outcome = await runner.run(
          {
            command: binary,
            args: ["chat", "--no-interactive", req.prompt],
            captureStdout: true,
            captureLimitBytes: stdoutLimit,
          },
          controller.signal,
        );
      } catch {
        outcome = { kind: "spawn-failed", message: "runner failed unexpectedly" };
      } finally {
        clearTimeout(timer);
        req.signal.removeEventListener("abort", onCallerAbort);
      }

      if (outcome.kind === "spawn-failed") {
        exitStatus = "spawn-failed";
        if (ENOENT_RE.test(outcome.message)) {
          return finish({
            kind: "binary-not-found",
            message: `kiro-cli: binary-not-found: '${binary}' was not found; install Kiro CLI and make sure it is on PATH`,
          });
        }
        return finish({ kind: "request-failed", message: `kiro-cli: could not start '${binary}'` });
      }

      if (outcome.kind === "aborted") {
        if (req.signal.aborted || !timedOut) {
          exitStatus = "aborted";
          return finish({ kind: "aborted", message: "kiro-cli: aborted" });
        }
        exitStatus = "timeout";
        return finish({ kind: "timeout", message: `kiro-cli: timeout after ${timeoutMs} ms` });
      }

      exitStatus = outcome.code;
      if (outcome.code !== 0) {
        const excerpt = outcome.stderr.slice(0, excerptChars);
        const lower = outcome.stderr.toLowerCase();
        if (hints.some((h) => lower.includes(h))) {
          return finish({
            kind: "not-logged-in",
            message: `kiro-cli: not-logged-in (exit ${outcome.code}); run \`kiro-cli login\`. stderr: ${excerpt}`,
          });
        }
        return finish({
          kind: "non-zero-exit",
          exitCode: outcome.code,
          message: `kiro-cli: non-zero-exit (exit ${outcome.code}). stderr: ${excerpt}`,
        });
      }

      const cleaned = cleanKiroCliOutput(outcome.stdout ?? "");
      if (cleaned === "") {
        return finish({ kind: "empty-output", message: "kiro-cli: empty-output (exit 0, no reply text)" });
      }
      logger?.info("kiro-cli-complete", { exitStatus, durationMs: now() - startedAt });
      return { ok: true, value: cleaned };
    },
  };
}
