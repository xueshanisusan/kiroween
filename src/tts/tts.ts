import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FFMPEG_BINARY,
  HTTP_RETRY_COUNT,
  PIPER_BINARY,
  PIPER_VOICE_MODEL_DIR,
  TTS_ENGINE,
  TTS_ENGINE_FILTERS,
  TTS_RADIO_FILTER,
  TTS_SENTENCE_SILENCE_SECONDS,
} from "../config/index.js";
import { ASSUMED_TTS_AUDIO_FORMAT } from "../config/tts-format.js";
import type { Result } from "../types.js";
import { createSeedAdapter } from "./seed.js";

export type TtsErrorKind =
  | "unconfigured"
  | "request"
  | "aborted"
  | "empty"
  // Seed engine kinds (task 19.2)
  | "missing-credentials"
  | "unauthorized"
  | "insufficient-credits"
  | "rate-limited"
  | "server-error"
  | "http-status"
  | "timeout"
  | "empty-audio"
  | "encode-failed";

export type TtsError = {
  kind: TtsErrorKind;
  message: string;
  /** Number of attempts made (first try plus retries). */
  attempts: number;
};

/** Voice provider boundary (Requirement 9.7). One call returns one complete MP3. */
export interface TtsAdapter {
  synthesize(script: string, voiceId: string, signal: AbortSignal): Promise<Result<Buffer, TtsError>>;
}

/** One child process to run. Arguments are an array; no shell is involved. */
export interface ProcessSpec {
  command: string;
  args: readonly string[];
  /** Text written to the child's stdin, then closed. */
  stdin?: string;
}

export type ProcessOutcome =
  | { kind: "exited"; code: number; stderr: string }
  | { kind: "spawn-failed"; message: string }
  | { kind: "aborted" };

/** Injected process runner. The real one wraps child_process; tests pass a fake. */
export interface ProcessRunner {
  run(spec: ProcessSpec, signal: AbortSignal): Promise<ProcessOutcome>;
}

/** Subset of ChildProcess the runner uses, so tests can supply a fake. */
export interface SpawnedChild {
  stdin: { write(data: string): unknown; end(): unknown; on(event: "error", cb: () => void): unknown } | null;
  stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close", cb: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

export type SpawnFn = (command: string, args: readonly string[]) => SpawnedChild;

const defaultSpawn: SpawnFn = (command, args) =>
  spawn(command, [...args], { shell: false, stdio: ["pipe", "ignore", "pipe"] }) as unknown as SpawnedChild;

/** Real runner. The abort signal kills the child process. */
export function createSpawnRunner(spawnFn: SpawnFn = defaultSpawn): ProcessRunner {
  return {
    run(spec, signal) {
      return new Promise<ProcessOutcome>((resolve) => {
        if (signal.aborted) {
          resolve({ kind: "aborted" });
          return;
        }
        let child: SpawnedChild;
        try {
          child = spawnFn(spec.command, spec.args);
        } catch (err) {
          resolve({ kind: "spawn-failed", message: err instanceof Error ? err.message : String(err) });
          return;
        }
        let stderr = "";
        let settled = false;
        const finish = (outcome: ProcessOutcome): void => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(outcome);
        };
        const onAbort = (): void => {
          child.kill("SIGKILL");
          finish({ kind: "aborted" });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        child.stderr?.on("data", (chunk) => {
          if (stderr.length < 2000) stderr += chunk.toString();
        });
        child.on("error", (err) => finish({ kind: "spawn-failed", message: err.message }));
        child.on("close", (code) => finish({ kind: "exited", code: code ?? -1, stderr }));
        if (child.stdin) {
          child.stdin.on("error", () => undefined); // a child that exits early closes the pipe
          if (spec.stdin !== undefined) child.stdin.write(spec.stdin);
          child.stdin.end();
        }
      });
    },
  };
}

/** Piper arguments: reads the script from stdin, writes one WAV file. */
export function buildPiperArgs(
  modelPath: string,
  wavPath: string,
  sentenceSilenceSeconds: number = TTS_SENTENCE_SILENCE_SECONDS,
): string[] {
  return ["--model", modelPath, "--output_file", wavPath, "--sentence_silence", String(sentenceSilenceSeconds)];
}

/**
 * ffmpeg arguments. Sample rate, channels, codec and bitrate are always set
 * explicitly, never left to ffmpeg defaults or the voice model's native rate.
 */
export function buildFfmpegArgs(wavPath: string, mp3Path: string, filter: string = TTS_RADIO_FILTER): string[] {
  return [
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-i",
    wavPath,
    ...(filter === "" ? [] : ["-af", filter]),
    "-ar",
    String(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz),
    "-ac",
    String(ASSUMED_TTS_AUDIO_FORMAT.channels),
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${ASSUMED_TTS_AUDIO_FORMAT.fakeBitrateKbps}k`,
    mp3Path,
  ];
}

/**
 * ffmpeg arguments for the Seed engine: same pinned format, with the Seed filter
 * from config (no -af when empty). Task 19.2's adapter uses this.
 */
export function buildSeedFfmpegArgs(inputPath: string, mp3Path: string, filter: string = TTS_ENGINE_FILTERS.seed): string[] {
  return buildFfmpegArgs(inputPath, mp3Path, filter);
}

/**
 * The only place that chooses a TTS implementation. An unset engine means Piper.
 * An unknown value returns a typed "unconfigured" error and nothing is synthesized.
 * `options.seed` lets tests inject a Seed factory.
 */
export function selectTtsAdapter(
  engine: string | undefined = TTS_ENGINE,
  options: { piper?: () => TtsAdapter; seed?: () => TtsAdapter } = {},
): Result<TtsAdapter, TtsError> {
  const name = engine === undefined || engine === "" ? "piper" : engine;
  if (name === "piper") return { ok: true, value: (options.piper ?? createLocalTtsAdapter)() };
  // seed.ts loads the OpenRouter SDK only with a dynamic import inside a request, so this static import never loads it.
  if (name === "seed") return { ok: true, value: (options.seed ?? (() => createSeedAdapter({ env: process.env })))() };
  return { ok: false, error: { kind: "unconfigured", message: `unknown TTS_ENGINE '${name}'`, attempts: 0 } };
}

export interface LocalTtsAdapterOptions {
  runner?: ProcessRunner;
  /** Retries after the first attempt. Defaults to HTTP_RETRY_COUNT. */
  retries?: number;
  piperBinary?: string;
  ffmpegBinary?: string;
  modelDir?: string;
  /** Parent directory for temp files. Defaults to the OS temp directory. */
  tempRoot?: string;
}

type Attempt = { ok: true; value: Buffer } | { ok: false; kind: TtsErrorKind; message: string; retry: boolean };

/** Local Piper + ffmpeg adapter. One non-streaming call returns one MP3 buffer. */
export function createLocalTtsAdapter(options: LocalTtsAdapterOptions = {}): TtsAdapter {
  const runner = options.runner ?? createSpawnRunner();
  const retries = options.retries ?? HTTP_RETRY_COUNT;
  const piper = options.piperBinary ?? PIPER_BINARY;
  const ffmpeg = options.ffmpegBinary ?? FFMPEG_BINARY;
  const modelDir = options.modelDir ?? PIPER_VOICE_MODEL_DIR;
  const tempRoot = options.tempRoot ?? tmpdir();

  async function attempt(script: string, voiceId: string, signal: AbortSignal): Promise<Attempt> {
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tempRoot, "briefing-tts-"));
      const wavPath = join(dir, "speech.wav");
      const mp3Path = join(dir, "speech.mp3");
      const steps: ProcessSpec[] = [
        { command: piper, args: buildPiperArgs(join(modelDir, `${voiceId}.onnx`), wavPath), stdin: script },
        { command: ffmpeg, args: buildFfmpegArgs(wavPath, mp3Path) },
      ];
      for (const step of steps) {
        const outcome = await runner.run(step, signal);
        if (outcome.kind === "aborted") return { ok: false, kind: "aborted", message: "aborted", retry: false };
        if (outcome.kind === "spawn-failed") {
          return { ok: false, kind: "request", message: `${step.command} failed to start: ${outcome.message}`, retry: true };
        }
        if (outcome.code !== 0) {
          const detail = outcome.stderr.trim().slice(0, 300);
          return {
            ok: false,
            kind: "request",
            message: `${step.command} exited with code ${outcome.code}${detail ? `: ${detail}` : ""}`,
            retry: true,
          };
        }
      }
      const size = await stat(mp3Path).then((s) => s.size, () => 0);
      if (size === 0) return { ok: false, kind: "empty", message: "empty audio output", retry: true };
      return { ok: true, value: await readFile(mp3Path) };
    } catch (err) {
      return { ok: false, kind: "request", message: err instanceof Error ? err.message : String(err), retry: true };
    } finally {
      if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    async synthesize(script, voiceId, signal) {
      const maxAttempts = retries + 1;
      for (let attempts = 1; attempts <= maxAttempts; attempts++) {
        if (signal.aborted) return { ok: false, error: { kind: "aborted", message: "aborted", attempts: attempts - 1 } };
        const result = await attempt(script, voiceId, signal);
        if (result.ok) return { ok: true, value: result.value };
        if (signal.aborted || !result.retry) {
          return { ok: false, error: { kind: "aborted", message: "aborted", attempts } };
        }
        if (attempts === maxAttempts) return { ok: false, error: { kind: result.kind, message: result.message, attempts } };
      }
      return { ok: false, error: { kind: "request", message: "unknown error", attempts: maxAttempts } };
    },
  };
}
