# Hard rules

Detail: .kiro/steering/{product,tech,structure}.md

Campus news → 60–120 s audio briefing, heard over a phone call.

MUST
- Script 150–300 English words (60–120 s @150wpm). Longer is a defect.
- Never invent facts; every sentence traceable to source text.
- Audio must be self-sufficient; nothing visual-only.
- Pre-generate MP3 in batch; phone path only plays a file. No TTS mid-call.
- Campus-specific values live in src/config/ only.

MUST NOT
- No call-in / recording / moderation in v1.
- No vector DB, embeddings, RAG, queue, ORM, auth, accounts.
- No new runtime dependency without a line in tech.md.

ASK, DON'T DECIDE: campus+feed URL, phone number owner, TTS vendor, web fallback.