---
inclusion: always
---

# Tech

## Decided

- TypeScript on Node 22, ESM.
- One deployable service; one cron entry point (`scripts/build-briefing.ts`).
- Episode and story metadata as JSON on local disk. MP3s on local disk, served by the same service as the player and the episode JSON. No database, no object storage, no bucket policy in v1.
- Twilio Programmable Voice for the line: inbound call → webhook returns TwiML that `<Play>`s a pre-generated public MP3 URL. **No synthesis on the call.**
- Vitest + fast-check.
- Structured JSON logs, one line per stage, `briefingId` on every line.
- Ingest reads the RSS feed only. **Do not scrape article pages in v1.** The feed carries full text; the parser strips HTML and that is the whole extraction step. A fixture copy of today's XML lives in content/fixtures/.

## Provisional

- RSS via `rss-parser`.
- LLM: whichever we have credits for, hidden behind `summarize/summarize.ts`.
- TTS: **Two engines behind one `TtsAdapter` interface, selected by `TTS_ENGINE` (`'piper' | 'seed'`) in `src/config/`. Default `'piper'`, so a clean checkout runs with no credentials.**
  - **Piper (tests and local default).** The adapter runs the `piper` binary as a subprocess with a downloaded English voice model and writes a WAV, then `ffmpeg` encodes it to one MP3. One offline call produces the whole MP3 (no streaming). Both binaries are system prerequisites, not npm packages, so no new runtime dependency is added. Engine, voice model and MP3 encoding settings live in `src/config/`.
  - **Seed Audio 1.0 via OpenRouter (production demo).** ByteDance Seed Audio 1.0 (`bytedance-seed/seed-audio-1-0`, non-streaming) through the official OpenRouter TypeScript SDK, `@openrouter/sdk`: `new OpenRouter({ apiKey })` then `await openRouter.tts.createSpeech({ speechRequest: { model, input, voice, responseFormat: 'mp3' } })`, which returns a `ReadableStream` of bytes. The adapter collects that stream into one `Buffer` (one call, no audio streaming), so callers never see a stream. The output goes through the same `ffmpeg` step as Piper, so the pinned MP3 format holds. `voice` is optional and provider-specific; the model supports `mp3` and `pcm`. Cost is about $0.15 per minute of audio, so roughly $0.15 to $0.30 per 60 to 120 s Episode. Errors carry `{ error: { code, message } }` with status 400, 401, 402, 403, 404, 429 or 502. `OPENROUTER_API_KEY` comes from the environment only. Model (`SEED_TTS_MODEL`), Seed speaker id (`SEED_TTS_VOICE`) and `SEED_TTS_TIMEOUT_MS` (ms) are named config in `src/config/`. The speaker id is an OPEN QUESTION in `product.md` until chosen by listening test. The SDK returns only the byte stream on success, so `X-Generation-Id` is not available and is not logged. Tests inject a fake `SpeechClient` and never import the SDK. Fallback only if voice selection proves unworkable: streaming `bytedance-seed/seed-tts-3-0`.
  - **New runtime dependency: `@openrouter/sdk`.** Added because it is the vendor's supported client for TTS and the user asked for it. Built-in `fetch` through `src/lib/http.ts` could do the same single POST, and we would own the request code, but the SDK is accepted anyway for typed requests and errors and fewer hand-written wire details. Checked with `npm view`: version 1.5.144, license Apache-2.0, one dependency (`zod`), no peer dependencies. Install with `npm install --save-exact @openrouter/sdk` so `package.json` pins the exact version, no caret. It is the only new runtime dependency, is imported only in `src/tts/seed.ts` (or one tiny factory beside it), and is never loaded by Piper, by tests or at request time.
  - **SDK call and `http.ts`.** The SDK call is the one network call outside `src/lib/http.ts`. The adapter supplies the same guarantees itself: timeout `SEED_TTS_TIMEOUT_MS` through an `AbortSignal` (the SDK accepts `signal` in its request options), up to `HTTP_RETRY_COUNT` retries for 429, 5xx and timeout only (never 400, 401, 402, 403, 404), SDK retry disabled, and mapping of SDK errors to typed `TtsError` kinds.
  - **Why a paid, credentialed service is now allowed.** The production demo needs better voice quality than Piper gives, and the team decided to use Seed Audio for it. OpenRouter bills per call, which is why TTS spend stays in the batch job. This replaces the earlier "no paid or credentialed service" rule for production only. Polly and ElevenLabs remain rejected on cost. Tests and local runs never call Seed.
  - **Spend control.** TTS spend happens only in the batch job `scripts/build-briefing.ts`. The build makes no TTS call when the Selected_Set is unchanged or when it publishes nothing. The web player and phone webhook only serve published files; no TTS or LLM call happens at request time.
  - Requirement still open: the voice must be intelligible over a phone speaker outdoors, so confirm it with a listen test for each engine.
  - **Piper voice (decided after a listening comparison):** Piper `en_US-ryan-high`, sentence pause 0.3 s (`--sentence_silence`; Piper's default 0.2 s sounded rushed and 0.7 s was too long), with a radio-style ffmpeg filter chain: `highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=4,aecho=0.8:0.5:45:0.25,volume=1.3`. Voice id, pause and filter are named constants in `src/config/`. Also sampled, not chosen: `en_GB-alan-medium`, `en_US-hfc_male-medium`. `en_US-joe-medium` fails to synthesize on the current Piper build.

## Forbidden

- No vector DB, no embeddings, no RAG. The corpus is five articles a day.
- No audio streaming, websockets, or real-time TTS mid-call.
- No queue or broker. A cron and JSON files on disk are enough; no database.
- No auth, no user accounts, no ORM.
- No scraping behind a login or paywall.
- No fine-tuning. Prompts plus fixtures.

## Why

- **Pre-generate, don't synthesize on demand.** A cold TTS call is 2–8 s of silence in someone's ear. Generation is a batch job; the phone path is a lookup.
- **`<Play>` over `<Say>`.** `<Say>` re-synthesizes every call, gives a flat robotic voice, and gives us no control over pacing. `<Play>` replays exactly the audio we QA'd.
- **One language end to end.** The whole pipeline is string manipulation; a second runtime buys nothing in a day.