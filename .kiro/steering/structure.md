---
inclusion: always
---

# Structure

## Shape
One Node service, layered, dependencies point one way:
ingest → summarize → tts → publish → (telephony reads publish, never the reverse)

## Current layout

```
.
├── .kiro/
│   └── steering/   # product.md, tech.md, structure.md
|── AGENTS.md       # make Kiro auto-read steering files
└── README.md       # Hackathon submission requirements
```

## Rules
- Keep `.kiro/` at the repo root and committed (specs in `.kiro/specs`, hooks in `.kiro/hooks`, steering in `.kiro/steering`).
- A `LICENSE` file (open source) is required at the root and does not exist yet.
- Put application source in a dedicated directory (for example `src/`) and tests beside it or in `tests/`. Update this file once the layout is decided.
- Keep `README.md` as the entry point for setup and run instructions.
- **Layers import downward only.** telephony must not import ingest. Shared shapes live in `src/types.ts`.
- **Adapters at the edges.** Every network call goes through `src/lib/http.ts` (timeout, one retry, typed error). TTS and telephony are interfaces with exactly one implementation each, so they can be swapped in one file.
- **Pure cores.** `summarize/length.ts`, `summarize/select.ts`, `ingest/normalize.ts` are pure: no I/O, no clock, no randomness. This is deliberate — they are the property-based testing targets.
- **Config over code.** Campus name, feed URLs, voice id, greeting text live in `src/config/`. Adding a campus must not require editing a module.
- kebab-case filenames, named exports only, one responsibility per file.
- `Result<T, E>` at boundaries; throw only for programmer error.
- No `any`, no default exports, and no new runtime dependency without a line in `tech.md` saying why the existing stack can't do it.
- Ingest reads RSS only. Extraction is HTML stripping from the feed's content:encoded — there is no article scraping and no per-site CSS selector.

## What goes where
- Prompt text lives beside its caller (`summarize/prompt.ts`), never inline in a function body.
- Anything a human might tune (word budget, story count, speaking rate) is a named constant in `config/`, with a comment stating its unit.
