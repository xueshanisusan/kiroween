---
inclusion: always
---

# Tech

# Tech

## Decided

- TypeScript on Node 22, ESM.
- One deployable service; one cron entry point (`scripts/build-briefing.ts`).
- Postgres locally/SQLite for episode + story metadata; S3 (or disk in dev) for MP3s.
- Twilio Programmable Voice for the line: inbound call → webhook returns TwiML that `<Play>`s a pre-generated public MP3 URL. **No synthesis on the call.**
- Vitest + fast-check.
- Structured JSON logs, one line per stage, `briefingId` on every line.

## Provisional

- RSS via `rss-parser`; article body via `cheerio` + a per-site selector in config.
- LLM: whichever we have credits for, hidden behind `summarize/summarize.ts`.
- TTS: Amazon Polly neural (cheap, SSML, same cloud as S3) unless it fails a listen test in a quiet room.

## Forbidden

- No vector DB, no embeddings, no RAG. The corpus is five articles a day.
- No audio streaming, websockets, or real-time TTS mid-call.
- No queue or broker. A cron and a table are enough.
- No auth, no user accounts, no ORM.
- No scraping behind a login or paywall.
- No fine-tuning. Prompts plus fixtures.

## Why

- **Pre-generate, don't synthesize on demand.** A cold TTS call is 2–8 s of silence in someone's ear. Generation is a batch job; the phone path is a lookup.
- **`<Play>` over `<Say>`.** `<Say>` re-synthesizes every call, gives a flat robotic voice, and gives us no control over pacing. `<Play>` replays exactly the audio we QA'd.
- **One language end to end.** The whole pipeline is string manipulation; a second runtime buys nothing in a day.