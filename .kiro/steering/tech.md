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
- TTS: **Local Piper, decided.** No paid or credentialed service. The adapter runs the `piper` binary as a subprocess with a downloaded English voice model and writes a WAV, then `ffmpeg` encodes it to one MP3. One offline call produces the whole MP3 (no streaming). Reason: Polly and ElevenLabs cost money, and a local engine needs no account, so the repo runs from a clean checkout. Both binaries are system prerequisites, not npm packages, so no new runtime dependency is added. Requirement still open: the voice must be intelligible over a phone speaker outdoors, so confirm it with a listen test. Engine, voice model and MP3 encoding settings live in `src/config/`.
  - **Voice (decided after a listening comparison):** Piper `en_US-ryan-high`, sentence pause 0.3 s (`--sentence_silence`; Piper's default 0.2 s sounded rushed and 0.7 s was too long), with a radio-style ffmpeg filter chain: `highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=4,aecho=0.8:0.5:45:0.25,volume=1.3`. Voice id, pause and filter are named constants in `src/config/`. Also sampled, not chosen: `en_GB-alan-medium`, `en_US-hfc_male-medium`. `en_US-joe-medium` fails to synthesize on the current Piper build.

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