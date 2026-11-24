# Brief: campus news you can hear (v1)

## Problem / Who / Why now
Campus news is long text on a portal nobody opens. Students who can't or won't look at a screen (screen-reader users, students walking with hands full) are shut out. v1 turns MIT News into one spoken briefing of about 116 s, played from a web page (primary) and a phone line (proof that no screen is needed). Why now: a one-day build for the Kiroween 2026 submission.

## v1 scope (each bullet is checkable)
**Pipeline**
- Source: `https://news.mit.edu/rss/feed`. Body = `content:encoded`, tags stripped, whitespace normalized. No scraping, no selectors.
- Selection: items with `pubDate` in the last 48 h, newest first, cap 3. If fewer than 3, widen to 7 days and state the covered dates in the intro. "Today" uses the campus timezone from config. `select.ts` takes `now` as a parameter.
- Summarize from the article's opening paragraphs plus one impact sentence from the body, not a uniform compression of the whole article.
- Word budget (150 wpm): 3 stories = 20 + 3 × 85 + 15 = 290 words (about 116 s). 2 stories = 20 + 2 × 120 + 15 = 275 (about 110 s). 1 story = 20 + 165 + 15 = 200 (about 80 s). No episode under 60 s is published.
- Passes: summarize the top 3 at 85 words, run grounding. If exactly 2 survive, re-summarize those 2 at 120 words. If exactly 1 survives, re-summarize it at 165. One extra LLM call, deterministic input. Re-summarized scripts go through the same grounding check once. There is no third pass. If the result is under 150 words total, publish nothing and serve "no new briefing today".
- Outlet and date are stated once, in the intro. A story names its source only when attributing a specific claim.
- Grounding is a pure function with no model in the loop. From each story script, extract (a) numeric tokens, including spelled-out numbers from a finite lexicon (two through ninety, hundred, thousand, million; "one" is excluded because it is common as a pronoun), (b) date expressions, (c) runs of capitalized words, excluding only tokens in a fixed sentence-starter stoplist (The, This, That, It, But, And, However, Meanwhile, According, Today, Yesterday, Tomorrow, still, also, now). The stoplist is a named constant. Capitalized words outside it are checked at any position, including the first word of a sentence. A weekday token passes if it matches the article's `pubDate` weekday or appears literally in the source text. Compare against that article's stripped text. Names are case-insensitive. Numbers are normalized (commas and currency symbols stripped, ordinals unified). Month names are mapped to one canonical form. Pass only if every extracted token is found.
- Template text (intro, outro, attribution line) is exempt. A failing story is dropped, with no fallback. An article body under 500 characters ("too thin", named constant) is dropped.
- Fewer than 3 survivors: the intro says "short briefing today". Zero survivors: publish nothing.
- One script row per story, concatenated at publish time into one MP3.
- Episode JSON carries `generatedFor` (a date) and each story's script. Web and phone compare `generatedFor` to today. On mismatch both say "no new briefing today". The web page then offers the latest episode labelled with its own date. A stale episode is never presented as today's.
- Cron runs every 20 minutes. It fetches the feed and rebuilds only when the selected item-ID set differs from the set behind the published episode. Worst case is up to 20 min plus a build of about 2–3 min, inside the 30-minute claim.
- Phone "no briefing" message is a pre-generated static MP3, deployed once, never synthesized on a call.
- LLM and voice must each produce a file offline in one call: no streaming, no mid-call synthesis.

**Delivery**
- One service serves the MP3, the episode JSON, the web player and the phone webhook. JSON plus local disk.
- Web player ready in under 1 s. Phone pickup to first word under 2 s. Separate budgets.
- Player: keyboard operable, announces state via `aria-live`, never autoplays. The transcript renders from episode JSON and shows with JS disabled.

**Tests and fixtures**
- Property tests: `length.ts` (word and character budgets) and the grounding check (a script missing any source entity is rejected; one containing every entity passes).
- MIT text is not committed. `content/fixtures/*.xml` is gitignored (`git ls-files content` was empty, so nothing needs removing). Commit `scripts/fetch-fixture.ts` and a hand-written `content/fixtures/synthetic-3-items.xml`. Tests use the synthetic file only.

## Non-goals
Keypad skip, per-story playback, article scraping, the 10-minute freshness target, lede-verbatim fallback, Postgres, S3, queue or broker, multi-campus demo, accounts, personalization, non-English, caller audio, committing MIT text.

## Architecture decision
**Pipeline A**: one cron run does the full pipeline and produces one MP3, with per-story scripts stored from day one.
**Why B lost:** B (per-story audio, TwiML assembled at call time) only adds skip, which is cut. Per-story rows already make skip a playback change, not a data migration. B would also put call-time assembly on the 2 s phone path for no v1 benefit.

## Decisions made
| Question | Decision | Reasoning | Reversible? |
| --- | --- | --- | --- |
| Source | MIT RSS, full text in feed | No scraping | Yes, config |
| Length | 290 / 275 / 200 words for 3 / 2 / 1 story | Fewer, sharper stories beat uniformly vague ones | Yes, constants |
| Interaction | One MP3, no skip | Smallest core loop | Yes |
| Selection | 48 h window, widen to 7 days, cap 3 | A rolling feed can serve old news as today's | Yes |
| Freshness | 20 min cron, rebuild on selected-set change | Cheap check, inside 30 min | Yes |
| Grounding | Pure entity check, template exempt, drop failures | Deterministic, no runtime judgement | Policy, yes |
| Survivors | Re-summarize 2 at 120, 1 at 165; under 150 words total publishes nothing | Fewer stories need more words to clear 60 s | Yes |
| Attribution | Once in intro | Per-story attribution eats the budget | Yes |
| Phone empty state | Static pre-generated MP3 | Resolves `<Play>` vs `<Say>` | Yes |
| Storage | JSON + disk, one service | Fewer moving parts | Moderate |

## Open risks
- OPEN: Voice provider. OPEN: LLM provider. OPEN: Web player design (subject to the accessibility bullets). The static phone MP3 depends on the voice choice.
- Meaning drift ("proposed" vs "approved") remains possible. The opening-paragraph rule reduces it, and the entity check cannot catch it. Do a human read of the demo briefing.
- Words-to-seconds assumes 150 wpm. Check the real MP3 duration against the 60 s floor.
- HTML stripping needs a hand-written strip or a dependency line in `tech.md`.
- Steering files still contain superseded lines (10 minutes, skip, Postgres, S3). You are updating them.

## Spec breakdown (build order: 1, then 2 and 3 in parallel)
1. **briefing-pipeline** (feature spec): ingest, select, summarize, grounding, publish. One headless pipeline sharing the synthetic fixture and the PBT boundary. The only writer of episode files. Imports nothing from web or telephony.
2. **web-player** (requirements-first): serves MP3 and episode JSON, renders the player, transcript and stale/empty states. Reads publish only. Owns the 1 s budget and the accessibility requirements.
3. **telephony** (design-first): Twilio webhook playing the latest MP3 or the static "no briefing" MP3. Reads publish only. Owns the 2 s budget.
