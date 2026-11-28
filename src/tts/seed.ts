/**
 * Seed Audio 1.0 TTS adapter (production engine) through the official OpenRouter SDK.
 *
 * This is the one documented exception to "every network call goes through src/lib/http.ts".
 * The adapter supplies the same guarantees itself: a timeout (SEED_TTS_TIMEOUT_MS), up to
 * HTTP_RETRY_COUNT retries for 429, 5xx and timeout only, and typed TtsError mapping.
 * The SDK's own retry is disabled.
 *
 * The SDK is loaded only by a dynamic import inside synthesize(), only when no client was
 * injected and the key is present. Piper, tests and engine selection never load it.
 *
 * X-Generation-Id: the SDK (1.5.144) returns only the byte stream on success, so no response
 * header is available and nothing extra is logged. Headers are never read from error objects.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FFMPEG_BINARY,
  HTTP_RETRY_COUNT,
  SEED_TTS_MODEL,
  SEED_TTS_TIMEOUT_MS,
  SEED_TTS_VOICE,
  TTS_ENGINE_FILTERS,
} from "../config/index.js";
import type { Result } from "../types.js";
import {
  buildSeedFfmpegArgs,
  createSpawnRunner,
  type ProcessRunner,
  type TtsAdapter,
  type TtsError,
  type TtsErrorKind,
} from "./tts.js";

/** The part of the SDK request this adapter uses. */
export interface SeedSpeechRequest {
  speechRequest: {
    model: string;
    input: string;
    /** Present only when a speaker id is configured. */
    voice?: string;
    responseFormat: "mp3";
  };
}

export interface SeedRequestOptions {
  signal?: AbortSignal;
  retries?: { strategy: "none" };
}

/** Minimal client boundary. The real one wraps `OpenRouter().tts.createSpeech`; tests pass a fake. */
export interface SpeechClient {
  createSpeech(request: SeedSpeechRequest, options?: SeedRequestOptions): Promise<ReadableStream<Uint8Array>>;
}

export interface SeedAdapterOptions {
  /** Injected client (tests). When absent, the real SDK client is created lazily. */
  client?: SpeechClient;
  /** Environment; OPENROUTER_API_KEY is read here. */
  env: Readonly<Record<string, string | undefined>>;
  model?: string;
  /** Seed speaker id. Empty or absent means no `voice` field is sent. */
  voice?: string;
  /** Timeout for one request (milliseconds). */
  timeoutMs?: number;
  /** Retries after the first attempt (count). */
  retries?: number;
  runner?: ProcessRunner;
  ffmpegBinary?: string;
  /** ffmpeg -af chain; empty means none. */
  filter?: string;
  tempRoot?: string;
}

/** Creates the real SDK client. The SDK is imported here and nowhere else. */
async function createOpenRouterClient(apiKey: string): Promise<SpeechClient> {
  const { OpenRouter } = await import("@openrouter/sdk");
  const sdk = new OpenRouter({ apiKey });
  return { createSpeech: (request, options) => sdk.tts.createSpeech(request, options) };
}

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Rejects when the signal aborts, so a hung call cannot outlive the timeout. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const onAbort = (): void => reject(new AbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function collectStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  return Buffer.concat(chunks);
}

type Failure = { kind: TtsErrorKind; message: string; retry: boolean };

/** Maps a thrown value structurally (statusCode and name). The response body is never recorded. */
function mapThrown(err: unknown): Failure {
  const rec = typeof err === "object" && err !== null ? (err as { statusCode?: unknown; name?: unknown }) : {};
  const status = typeof rec.statusCode === "number" ? rec.statusCode : undefined;
  const name = typeof rec.name === "string" ? rec.name : "";
  if (status !== undefined) {
    const message = `Seed TTS request failed with status ${status}`;
    if (status === 401) return { kind: "unauthorized", message, retry: false };
    if (status === 402) return { kind: "insufficient-credits", message, retry: false };
    if (status === 429) return { kind: "rate-limited", message, retry: true };
    if (status >= 500) return { kind: "server-error", message, retry: true };
    return { kind: "http-status", message, retry: false };
  }
  if (name === "RequestTimeoutError") return { kind: "timeout", message: "Seed TTS request timed out", retry: true };
  if (name === "RequestAbortedError") return { kind: "aborted", message: "aborted", retry: false };
  if (name === "ConnectionError") return { kind: "server-error", message: "Seed TTS connection failed", retry: false };
  return { kind: "request", message: `Seed TTS request failed (${name || "unknown error"})`, retry: false };
}

/** Seed adapter. One non-streaming call per build returns one pinned-format MP3 buffer. */
export function createSeedAdapter(options: SeedAdapterOptions): TtsAdapter {
  const apiKey = (options.env.OPENROUTER_API_KEY ?? "").trim();
  const model = options.model ?? SEED_TTS_MODEL;
  const voice = options.voice ?? SEED_TTS_VOICE;
  const timeoutMs = options.timeoutMs ?? SEED_TTS_TIMEOUT_MS;
  const retries = options.retries ?? HTTP_RETRY_COUNT;
  const runner = options.runner ?? createSpawnRunner();
  const ffmpeg = options.ffmpegBinary ?? FFMPEG_BINARY;
  const filter = options.filter ?? TTS_ENGINE_FILTERS.seed;
  const tempRoot = options.tempRoot ?? tmpdir();
  let client: SpeechClient | undefined = options.client;

  async function encode(audio: Buffer, signal: AbortSignal): Promise<Result<Buffer, Failure>> {
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tempRoot, "briefing-seed-"));
      const inputPath = join(dir, "seed-input.mp3");
      const mp3Path = join(dir, "seed-output.mp3");
      await writeFile(inputPath, audio);
      const outcome = await runner.run({ command: ffmpeg, args: buildSeedFfmpegArgs(inputPath, mp3Path, filter) }, signal);
      if (outcome.kind === "aborted") return { ok: false, error: { kind: "aborted", message: "aborted", retry: false } };
      if (outcome.kind === "spawn-failed") {
        return { ok: false, error: { kind: "encode-failed", message: `${ffmpeg} failed to start`, retry: false } };
      }
      if (outcome.code !== 0) {
        return { ok: false, error: { kind: "encode-failed", message: `${ffmpeg} exited with code ${outcome.code}`, retry: false } };
      }
      const size = await stat(mp3Path).then((s) => s.size, () => 0);
      if (size === 0) return { ok: false, error: { kind: "encode-failed", message: "ffmpeg produced no output", retry: false } };
      return { ok: true, value: await readFile(mp3Path) };
    } catch {
      return { ok: false, error: { kind: "encode-failed", message: "encoding failed", retry: false } };
    } finally {
      if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** One request attempt: returns raw audio bytes or a failure. */
  async function attempt(script: string, buildSignal: AbortSignal): Promise<Result<Buffer, Failure>> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([buildSignal, timeoutSignal]);
    try {
      if (client === undefined) client = await createOpenRouterClient(apiKey);
      const request: SeedSpeechRequest = {
        speechRequest: {
          model,
          input: script,
          ...(voice === "" ? {} : { voice }),
          responseFormat: "mp3",
        },
      };
      const stream = await raceAbort(client.createSpeech(request, { signal, retries: { strategy: "none" } }), signal);
      const audio = await collectStream(stream, signal);
      if (audio.length === 0) return { ok: false, error: { kind: "empty-audio", message: "Seed TTS returned no audio", retry: false } };
      return { ok: true, value: audio };
    } catch (err) {
      if (buildSignal.aborted) return { ok: false, error: { kind: "aborted", message: "aborted", retry: false } };
      if (timeoutSignal.aborted) return { ok: false, error: { kind: "timeout", message: "Seed TTS request timed out", retry: true } };
      return { ok: false, error: mapThrown(err) };
    }
  }

  return {
    // The voiceId argument is the Piper voice; Seed uses only its own configured speaker id.
    async synthesize(script, _voiceId, buildSignal) {
      if (apiKey === "") {
        return { ok: false, error: { kind: "missing-credentials", message: "OPENROUTER_API_KEY is not set", attempts: 0 } };
      }
      const maxAttempts = retries + 1;
      for (let attempts = 1; attempts <= maxAttempts; attempts++) {
        if (buildSignal.aborted) return fail({ kind: "aborted", message: "aborted", retry: false }, attempts - 1);
        const res = await attempt(script, buildSignal);
        if (res.ok) {
          const encoded = await encode(res.value, buildSignal);
          if (encoded.ok) return { ok: true, value: encoded.value };
          return fail(encoded.error, attempts);
        }
        if (!res.error.retry || attempts === maxAttempts) return fail(res.error, attempts);
      }
      return fail({ kind: "request", message: "unknown error", retry: false }, maxAttempts);
    },
  };
}

function fail(f: Failure, attempts: number): Result<Buffer, TtsError> {
  return { ok: false, error: { kind: f.kind, message: f.message, attempts } };
}
