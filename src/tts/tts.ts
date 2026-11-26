import { ASSUMED_TTS_AUDIO_FORMAT } from "../config/tts-format.js";
import { HTTP_RETRY_COUNT } from "../config/index.js";
import type { Result } from "../types.js";

export type TtsErrorKind = "unconfigured" | "request" | "aborted" | "empty";

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

/** Parameters of a Polly SynthesizeSpeech request (non-streaming, text input). */
export interface PollySynthesizeRequest {
  OutputFormat: "mp3";
  Engine: "neural";
  SampleRate: string;
  Text: string;
  TextType: "text";
  VoiceId: string;
}

/** Injected Polly client. The real one wraps the provider; tests pass a fake. */
export interface PollyClient {
  synthesizeSpeech(req: PollySynthesizeRequest, signal: AbortSignal): Promise<Uint8Array>;
}

/**
 * Builds the request. Engine and SampleRate are always set explicitly, never left to
 * provider defaults (the engine defaults to standard when omitted).
 */
export function buildPollyRequest(script: string, voiceId: string): PollySynthesizeRequest {
  return {
    OutputFormat: "mp3",
    Engine: "neural",
    SampleRate: String(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz),
    Text: script,
    TextType: "text",
    VoiceId: voiceId,
  };
}

export interface PollyAdapterOptions {
  /** Retries after the first attempt. Defaults to HTTP_RETRY_COUNT. */
  retries?: number;
}

export function createPollyAdapter(client: PollyClient, options: PollyAdapterOptions = {}): TtsAdapter {
  const retries = options.retries ?? HTTP_RETRY_COUNT;
  return {
    async synthesize(script, voiceId, signal) {
      const req = buildPollyRequest(script, voiceId);
      const maxAttempts = retries + 1;
      let lastMessage = "unknown error";
      for (let attempts = 1; attempts <= maxAttempts; attempts++) {
        if (signal.aborted) return { ok: false, error: { kind: "aborted", message: "aborted", attempts: attempts - 1 } };
        try {
          const audio = await client.synthesizeSpeech(req, signal);
          if (audio.byteLength === 0) {
            lastMessage = "empty audio response";
            if (attempts === maxAttempts) return { ok: false, error: { kind: "empty", message: lastMessage, attempts } };
            continue;
          }
          return { ok: true, value: Buffer.from(audio) };
        } catch (err) {
          if (signal.aborted) return { ok: false, error: { kind: "aborted", message: "aborted", attempts } };
          lastMessage = err instanceof Error ? err.message : String(err);
          if (attempts === maxAttempts) return { ok: false, error: { kind: "request", message: lastMessage, attempts } };
        }
      }
      return { ok: false, error: { kind: "request", message: lastMessage, attempts: maxAttempts } };
    },
  };
}

/**
 * Real Polly client. Credentials come from the environment only. No AWS SDK is a
 * dependency, so this stub reports a typed failure until a signed client is wired in.
 */
export function createEnvPollyClient(env: NodeJS.ProcessEnv = process.env): PollyClient {
  return {
    async synthesizeSpeech() {
      if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_REGION) {
        throw new Error("Polly credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)");
      }
      throw new Error("Polly client not implemented: no AWS SDK dependency");
    },
  };
}
