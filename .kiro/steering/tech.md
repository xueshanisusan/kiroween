---
inclusion: always
---

# Tech

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

- RSS via `rss-parser`; article body via `cheerio` + a per-site selector in config.
- LLM: whichever we have credits for, hidden behind `summarize/summarize.ts`.
- TTS: **OPEN — decide after a real listen test.** Requirements: one offline call produces the whole MP3 (no streaming), and the voice is intelligible over a phone speaker outdoors, not in a quiet room. Amazon Polly neural is the default candidate on cost, not a decision.

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