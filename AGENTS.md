# Hard rules

Detail: .kiro/steering/{product,tech,structure}.md

Campus news → 60–120 s audio briefing, heard over a phone call.

MUST
- Script 150–300 English words (60–120 s @150wpm). Longer is a defect.
- Never invent facts; every sentence traceable to source text.
- Audio must be self-sufficient; nothing visual-only.
- Pre-generate MP3 in batch; phone path and web player only serve the published file. No TTS or LLM call at request time. TTS spend only in scripts/build-briefing.ts, never when the story set is unchanged or nothing is published.
- TTS engine is chosen by TTS_ENGINE in src/config/ ('piper' default for tests/local; 'seed' for production). Credentials come from environment variables only; tests never call a real TTS service. Seed uses the official `@openrouter/sdk` (exact version pinned), imported only in src/tts/seed.ts; tests inject a fake client and never import it.
- Campus-specific values live in src/config/ only.

MUST NOT
- No call-in / recording / moderation in v1.
- No vector DB, embeddings, RAG, queue, ORM, auth, accounts.
- No new runtime dependency without a line in tech.md. The only one allowed so far is `@openrouter/sdk` (Seed TTS).
- Every network call goes through src/lib/http.ts, except the Seed adapter's SDK call, which must provide its own timeout, retry-only-on-429/5xx/timeout and typed TtsError mapping.

ASK, DON'T DECIDE: campus+feed URL, phone number owner, web fallback, Seed speaker id / SEED_TTS_VOICE (TTS is decided: Piper for tests/local, Seed Audio via OpenRouter for production; key in OPENROUTER_API_KEY, env only).