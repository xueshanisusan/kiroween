---
inclusion: always
---

# Product: campus news you can hear

## One line

Turns a campus news feed into a 60–120 second audio briefing a student can hear by calling a phone number. You don't need an app, a screen, or to scroll.

## Why this exists

Campus news is published as long, text-heavy articles on a portal nobody opens.
Two groups are structurally shut out:
- Students with visual impairments or reading disabilities who already spend the
  day fighting screen readers on dense layouts.
- Students in transit — walking across campus, on a shuttle, late at night —
  whose hands and eyes are busy and for whom "just open the portal" is not real.

The reason to exist is **access without a screen**. Any feature that requires the
user to look at something is suspect by default.

The project is also a hackathon project (Kiroween 2026, #KiroweenHackathon26).

## Primary user (v1)

A student walking between classes, one hand free, earbuds in, 90 seconds to spare.

Secondary: a screen-reader user who wants the day's news as one linear audio stream instead of five separate article pages.

## Core loop

1. Ingest campus RSS feed(s).
2. Extract full article text (feeds usually carry only an excerpt).
3. Summarize into a spoken script of 60–120 s, neutral tone, outlet and date stated once in the intro.
4. Synthesize one MP3 per campus per day.
5. Student hears one continuous briefing MP3. No keypad interaction in v1. Scripts are stored per story and concatenated at publish time, so adding skip later is a playback change, not a data migration.

Two performance requirements that shape everything:

- The episode rebuilds when the selected story set changes. Worst case a new story is audible within 30 minutes. There is no "live within N minutes" target.
- Phone path only: pickup → first word in under 2 seconds. This target does not apply to the web player, whose target is "player ready under 1 second".

## Hard constraints

- **Length is a feature.** 60–120 s ≈ 150–300 English words at 150 wpm. A 400-word script is a defect.
- **No invented facts.** Every sentence traces to source text. If extraction is thin or a claim can't be grounded, drop the story. If no story survives, or the final script is under 150 words, publish nothing. Never fill a gap with plausible background — this is news, not content.
- **Audio alone must be sufficient.** No information may live only in a visual UI.
- **Attribution once.** The intro states the outlet and date once. A story names its source only when attributing a specific claim.
- **One briefing per campus per day, cached** — not regenerated per caller.

## Demo source (decided)
Demo runs against MIT News' public RSS feed: https://news.mit.edu/rss/feed
Chosen because it is verified working, carries full article text in the feed, and publishes near-daily. It is research and institutional news, not student-life news — do not describe the product as "student voices".
The pipeline is campus-agnostic: a different school means different config, not different code.

## Non-goals for v1

- Live call-in, recording listener voices, LLM moderation of caller audio.
- Multi-tenant onboarding, billing, admin console.
- Per-user personalization or recommendations.
- Music, ads, sponsorship reads.
- Languages other than English.

## Considered and parked (do not build unless explicitly asked)
| Idea | Why parked |
| --- | --- |
| Call-in + replay a caller's voice on the next call ("dial-a-news") | Needs consent, moderation and storage, and destroys the <2 s answer time. Great season-2 feature. |
| "Skeleton Crew": framework any college can adopt | This is positioning, not a v1 deliverable. v1 = one campus end to end, but every campus-specific value lives in config so the claim stays honest. |
| Mobile app with push notifications | Contradicts the no-install, no-screen premise. |

## Positioning (for the write-up, not for code)
Reference implementation of a lean, campus-agnostic pipeline: campus identity,
feed URLs, voice and greeting are config; everything else is shared. Demo one
campus, claim "swap the config, get another campus".

## OPEN QUESTIONS — Kiro: if a task depends on one of these, STOP and ask.
- [x] Which campus, which feed URL? Official RSS, or scrape the news index?
- [x] Phone number: Twilio trial number acceptable? Who owns it?
- [ ] Voice: Polly neural vs ElevenLabs (quality vs cost/latency)?
- [ ] Do judges need a web fallback player for people who can't dial in?

## Submission requirements that affect the code

- The repo must be public and include an open source license file.
- All source, assets, and setup instructions must be in the repo so the project runs from a clean checkout.
- The `.kiro/` directory must stay at the repo root and be committed. It shows use of specs, hooks, and steering.
- The project needs a working app URL and a demo video under 3 minutes, so keep it deployable and easy to demo.
- Do not add third-party trademarks or copyrighted material (music, images, fonts without a license).
