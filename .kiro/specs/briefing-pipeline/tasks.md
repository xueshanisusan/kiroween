# Implementation Plan: briefing-pipeline

## Overview

Implementation language is TypeScript (ESM, Node 22, Vitest, fast-check), as used in design.md. The plan follows the design's Implementation Order: fixture first (blocking), then pure cores, then adapters, then orchestration, then pipeline-level example tests, then a manual audit.

Rules that apply to every task:

- Task 1 (the synthetic fixture) is BLOCKING. Every test task below lists it as a prerequisite and reads feed input only from `content/fixtures/synthetic-3-items.xml` (Requirement 14.2).
- The only runtime dependency allowed is `rss-parser` (named in `tech.md`). HTML stripping is hand-written. No cheerio, no schema library, no MP3 library.
- Exactly six property-based tests exist: Properties 8, 1, 9, 11, 13 and 16 (tasks 4.3, 5.4, 6.3, 7.2, 8.2, 9.2). Each uses `PROPERTY_TEST_RUNS` as the run count and carries a `// Feature: briefing-pipeline, Property N: ...` tag comment. Every other property in design.md is covered by example tests only, as listed in the design's Property test budget table. Do NOT add any other property-based test. Property 6 (Whitespace_Normalizer idempotence) has NO test.
- All test tasks are required (not optional). Only the manual audit (task 18.1) is optional.

## Tasks

- [x] 1. BLOCKING: Write the synthetic fixture
  - Hand-write `content/fixtures/synthetic-3-items.xml`: an RSS 2.0 document with the `content` namespace and three fake items shaped like real MIT News items (`guid`, `title`, `pubDate`, `content:encoded`)
  - `content:encoded` bodies hold realistic HTML: at least one `<p>`, one `<a>`, one `<img>` with a `data-caption` attribute, and at least one character entity (for example `&mdash;` and `&amp;`)
  - Each body must be at least 500 characters of text after stripping, so no item is too thin; use plain invented text with some numbers, a date and capitalized names so grounding tests have material. Use `pubDate` values in 2026-11 so the Selector tests have stable dates
  - Contain no real MIT text
  - No test in this plan can run before this file exists
  - _Requirements: 14.1, 14.2, 1.2, 2.1_

- [x] 2. Project scaffolding and gitignore check
  - Create `package.json` (`"type": "module"`, Node 22 engines, scripts for `test` as `vitest --run`, and `typecheck`), `tsconfig.json` (strict, ESM, NodeNext), and a Vitest config
  - Dependencies: `rss-parser` as the only runtime dependency; dev dependencies `typescript`, `vitest`, `fast-check`, `@types/node`, `tsx`. Add no other runtime dependency
  - Create the `src/` layout from design.md: `config/`, `ingest/`, `select/`, `summarize/`, `ground/`, `length/`, `tts/`, `publish/`, `pipeline/`, `lib/`, plus `scripts/` and `test/helpers/`
  - Verify `.gitignore` already contains `content/fixtures/*.xml` followed by `!content/fixtures/synthetic-*.xml` (it does today); change nothing unless a line is missing
  - Confirm `git check-ignore` does not ignore `content/fixtures/synthetic-3-items.xml`
  - Prerequisite: task 1
  - _Requirements: 14.1, 15.2, 15.3_

- [x] 3. Manual-audit tool `scripts/fetch-fixture.ts`
  - MANUAL AUDIT TOOL ONLY. It is NOT part of the test suite. No test imports it, runs it, or reads the files it writes
  - A human runs it outside tests to download a real feed snapshot into `content/fixtures/` (for example `mit-<date>.xml`) for local inspection. Use plain `fetch`, not `src/lib/http.ts`
  - The snapshot is covered by the gitignore rule `content/fixtures/*.xml` and is never committed
  - Prerequisite: task 2
  - _Requirements: 14.1, 14.2_

- [x] 4. Configuration constants and pinned tables
  - [x] 4.1 Create `src/types.ts` and `src/config/*` constants
    - `Result<T, E>` type in `src/types.ts`
    - Config constants, each with a unit comment: campus name, Feed URL, `CAMPUS_TIMEZONE`, voice id, greeting text, speaking rate 150 words per minute, story word targets (85, 120, 165), intro 20 and outro 15 words, Length_Budget per story count (290, 275, 200), 150-word floor, `TOO_THIN_THRESHOLD` 500, story count cap 3, `PROPERTY_TEST_RUNS` 100, `HTTP_RETRY_COUNT` 1, `MIN_EPISODE_SECONDS` 60, `BUILD_BUDGET_SECONDS` 300, `BUILD_LOCK_GRACE_SECONDS` 60, cron interval 1200
    - `src/config/tts-format.ts` with `ASSUMED_TTS_AUDIO_FORMAT` exactly as in design.md (MPEG-2, Layer III, 24000 Hz, mono, bitrateMode note, `fakeBitrateKbps` 48)
    - Prerequisite: task 2
    - _Requirements: 15.1, 15.5, 8.2, 11.13, 12.1_

  - [x] 4.2 Create the tag, entity, stoplist and lexicon constants
    - `src/config/tags.ts`: `KNOWN_TAG_SET` and `BLOCK_TAG_SET` exactly as listed in the Glossary
    - `src/config/entities.ts`: the pinned named-entity table (amp, lt, gt, quot, apos, nbsp to U+0020, mdash, ndash, lsquo, rsquo, ldquo, rdquo, hellip)
    - `src/config/grounding.ts`: `SENTENCE_STARTER_STOPLIST` and `NUMBER_LEXICON` (two through ninety, hundred, thousand, million; "one" excluded)
    - Prerequisite: task 4.1
    - _Requirements: 2.1, 2.8, 2.16, 5.1, 5.3, 5.4_

  - [x] 4.3 Write property test for Block_Tag_Set subset (Property 8)
    - **Property 8: Block_Tag_Set is a subset of Known_Tag_Set**
    - `// Feature: briefing-pipeline, Property 8: Block_Tag_Set is a subset of Known_Tag_Set`
    - fast-check with `PROPERTY_TEST_RUNS` runs, quantified over every member of `BLOCK_TAG_SET`. This is one of exactly six property-based tests
    - Prerequisites: tasks 1 and 4.2
    - **Validates: Requirements 2.16, 14.11**

- [x] 5. Normalizer (A1 Tag_Stripper, B Entity_Decoder, A2 Whitespace_Normalizer)
  - [x] 5.1 Implement `stripTags` in `src/ingest/normalize.ts`
    - Single left-to-right pass per the design's A1 algorithm: block tags give one space, other known tags give nothing, `script`/`style`/comment removed with contents and no space, unknown tag-shaped text preserved and its name reported, stray `<` literal
    - Quote-aware search for the closing `>` and for `</script>`/`</style>`
    - Unclosed `script`, `style` or `<!--` drops to end of input and returns `{ name, offset }`
    - Pure, no iteration to a fixpoint
    - Prerequisite: task 4.2
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.10, 2.13, 2.14, 2.15_

  - [x] 5.2 Implement `decodeEntities` in `src/ingest/normalize.ts`
    - Single pass: decimal and hex numeric references plus the pinned named table; `&nbsp;` to U+0020
    - Unknown named references copied unchanged and reported in `unrecognisedEntities`
    - Numeric references above 0x10FFFF, in 0xD800 to 0xDFFF, or equal to 0 copied unchanged and reported in `invalidNumericRefs`
    - Never re-scan its own output
    - Prerequisite: task 5.1 (same file)
    - _Requirements: 2.6, 2.7, 2.8_

  - [x] 5.3 Implement `normalizeWhitespace` and `normalize` in `src/ingest/normalize.ts`
    - `normalizeWhitespace` collapses runs of U+0020, tab, LF, CR, FF, VT and U+00A0 to one space and trims
    - `normalize` composes A1, then B, then A2, each exactly once, in that order, and returns a `NormalizeReport` with the Source_Text and all reported side data
    - Prerequisite: task 5.2 (same file)
    - _Requirements: 2.2, 2.3, 2.4, 2.9, 2.11, 2.12_

  - [x] 5.4 Write property test for Tag_Stripper provenance (Property 1)
    - **Property 1: Tag_Stripper character provenance**
    - `// Feature: briefing-pipeline, Property 1: Tag_Stripper character provenance`
    - fast-check with `PROPERTY_TEST_RUNS` runs. Generator mixes plain text, known tags (block and non-block, mixed case), unknown tag-shaped fragments, stray `<`, quoted attribute values containing `<` and `>`, and whitespace runs including U+00A0
    - Supply the regressions as fast-check `examples`, so they run every time: `<<b>b>` (expected Tag_Stripper output `<b>`) and `<p>end.</p><p>Next</p>` (expected Source_Text `end. Next` through the full `normalize`)
    - This is one of exactly six property-based tests. Do NOT add a property test for Property 2, 3, 4, 5, 6 or 7
    - Prerequisites: tasks 1 and 5.3
    - **Validates: Requirements 2.1, 2.5, 2.10, 2.14, 14.7, 14.8**

  - [x] 5.5 Write example tests for the Tag_Stripper
    - Literal regression inputs: `<<b>b>` gives `<b>`; `<p>end.</p><p>Next</p>` gives `end. Next` through `normalize`; `<p>a</p><script>var x = 1;</script><p>b</p>` gives `a b` with `var x` absent; `x<y and y>z` unchanged with `unknownTagNames` exactly `["y"]` (Property 2)
    - Unclosed `script`, unclosed `style` and unclosed `<!--`: output drops to end of input and the element name and offset are returned
    - Quote-aware tag end: `<img data-caption="a > b">text` leaves only `text`, and an unterminated quote makes `<` literal
    - Script, style and comment contents leave no trace and no extra space (Property 7)
    - Case-insensitive tag names; `5 < 6` unchanged
    - Examples only. No property-based tests here
    - Prerequisites: tasks 1 and 5.3
    - _Requirements: 2.1, 2.10, 2.13, 2.14, 2.15, 14.7, 14.8, 14.9, 14.10_

  - [x] 5.6 Write example tests for the Entity_Decoder and `normalize`
    - Every entity in the pinned table decodes to its mapped character
    - Unknown named reference `&foo;` preserved and reported once (Property 3)
    - Invalid numeric references (`&#0;`, `&#xD800;`, `&#x110000;`) preserved and reported
    - `&amp;lt;` decodes to `&lt;` and no further (Property 4)
    - `&lt;b&gt;` through `normalize` gives `<b>` (Property 5)
    - `&nbsp;`, `&#160;` and a raw U+00A0 collapse identically
    - `normalize` of the fixture items drops the `img` caption text and keeps the entity-decoded text
    - Property 6 (A2 idempotence) gets NO test
    - Prerequisites: tasks 1 and 5.3
    - _Requirements: 2.2, 2.6, 2.7, 2.8, 2.9, 2.1_

- [ ] 6. Selector and too-thin rule
  - [ ] 6.1 Implement `select` in `src/select/select.ts`
    - Pure, takes `now` and `campusTimezone`; 48-hour window, widen to 7 days when fewer than 3, ignore future items, tie-break by `guid` ascending, at most 3, `coveredDates` in Campus_Timezone only when widened, empty when nothing within 7 days
    - Prerequisite: task 4.1
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 6.2 Implement the too-thin rule in `src/select/too-thin.ts`
    - Pure predicate: Source_Text shorter than `TOO_THIN_THRESHOLD` is thin
    - Prerequisite: task 4.1
    - _Requirements: 6.2_

  - [ ] 6.3 Write property test for Selector invariants (Property 9)
    - **Property 9: Selector invariants**
    - `// Feature: briefing-pipeline, Property 9: Selector invariants`
    - fast-check with `PROPERTY_TEST_RUNS` runs; random item lists (duplicate and future `pubDate`s included) and random `now`. Items may be built from the fixture's shape. This is one of exactly six property-based tests
    - Prerequisites: tasks 1 and 6.1
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 14.4**

  - [ ] 6.4 Write example tests for the Selector and too-thin rule
    - Items parsed from the fixture feed select newest first; widening example returns `coveredDates`; tie-break by `guid`
    - Too_Thin_Threshold boundaries at 499, 500 and 501 characters
    - Prerequisites: tasks 1, 6.1 and 6.2
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 6.2_

- [ ] 7. Length_Module
  - [ ] 7.1 Implement `src/length/length.ts`
    - `wordCount` (split on whitespace), `isAcceptableLength(totalWords, finalStoryCount)` true iff 150 <= words <= budget (290, 275, 200)
    - Pure, no I/O, clock or randomness
    - Prerequisite: task 4.1
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.8_

  - [ ] 7.2 Write property test for the length budget (Property 11)
    - **Property 11: Length acceptance predicate matches the exact budget range**
    - `// Feature: briefing-pipeline, Property 11: Length acceptance predicate matches the exact budget range`
    - fast-check with `PROPERTY_TEST_RUNS` runs; word counts around and across 150 and each budget, for story counts 1, 2 and 3. Put the Property 10 additivity assertions in this test file as plain example assertions, not a second property test. This is one of exactly six property-based tests
    - Prerequisites: tasks 1 and 7.1
    - **Validates: Requirements 8.4, 8.5, 8.7, 8.8, 14.3**

  - [ ] 7.3 Write example tests for length thresholds
    - Floor at 149, 150 and 151 words; ceiling at budget and budget + 1 for each story count
    - Prerequisites: tasks 1 and 7.1
    - _Requirements: 8.4, 8.5, 8.8_

- [ ] 8. Grounding_Checker
  - [ ] 8.1 Implement `src/ground/ground.ts`
    - `extractTokens` (numbers including Number_Lexicon words, dates, capitalized-word runs minus stoplist at any sentence position) and `checkGrounding(script, sourceText, pubDateWeekday)` returning `{ passed, missing }`
    - Case-insensitive names; numbers normalized (commas, currency, ordinals); months to canonical form; weekday accepted if equal to the pubDate weekday or present in the source
    - Pure, no model, I/O or clock; never applied to Template_Text
    - Prerequisite: task 4.2
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.15_

  - [ ] 8.2 Write property test for grounding rejection (Property 13)
    - **Property 13: Removing a grounded entity from the source causes grounding to fail**
    - `// Feature: briefing-pipeline, Property 13: Removing a grounded entity from the source causes grounding to fail`
    - fast-check with `PROPERTY_TEST_RUNS` runs. Generator builds Source_Text from random numbers (comma, currency, ordinal and spelled-out forms), dates (month form and weekday) and capitalized-name runs (random casing, stoplist words interspersed), then builds a Story_Script using only entities from that Source_Text (the Property 12 construction)
    - NON-NEGOTIABLE: the test asserts the PASS result for the unmodified pair FIRST. If that assertion fails, the test fails. Never filter or discard cases: no `fc.pre`, no skipped cases
    - Then remove one occurrence of an entity the script relies on from the Source_Text, re-check the same script, and assert a fail result whose missing list names that entity
    - Property 12 is covered inside this test. This is one of exactly six property-based tests
    - Prerequisites: tasks 1 and 8.1
    - **Validates: Requirements 5.11, 5.13, 5.14, 14.3**

  - [ ] 8.3 Write example tests for grounding
    - Property 14: a script using an entity present only in a second Source_Text fails against the first
    - Weekday accepted by pubDate and by literal presence; month `Jan` equals `January`; `3rd` equals `3`; stoplist words not checked; Template_Text not checked
    - Source texts come from `normalize` of fixture items
    - Prerequisites: tasks 1 and 8.1
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9, 5.15_

- [ ] 9. Episode_JSON codec and `generatedFor`
  - [ ] 9.1 Implement `EpisodeJson`, `serializeEpisode`, `parseEpisode` in `src/publish/episode-json.ts`
    - Hand-written validation in the order given in design.md: JSON syntax, `generatedFor` format and real calendar date, `selectedItemIds` string array, `stories` array of objects with string `guid`, `title`, `script`
    - Typed error names the first invalid field; stable key order on serialize; no I/O
    - Prerequisite: task 4.1
    - _Requirements: 10.2, 10.7, 10.8, 10.9, 10.10_

  - [ ] 9.2 Write property test for the Episode_JSON round trip (Property 16)
    - **Property 16: Episode_JSON round-trips through serialize and parse**
    - `// Feature: briefing-pipeline, Property 16: Episode_JSON round-trips through serialize and parse`
    - fast-check with `PROPERTY_TEST_RUNS` runs over random valid `EpisodeJson` values (arbitrary strings, empty and non-empty arrays, valid dates). This is one of exactly six property-based tests
    - Prerequisites: tasks 1 and 9.1
    - **Validates: Requirements 10.7, 10.9, 14.4**

  - [ ] 9.3 Implement `generatedFor` and write example tests for the codec and date
    - Implement `generatedFor(now, campusTimezone)` in `src/publish/generated-for.ts` using `Intl.DateTimeFormat`, no new dependency
    - Example tests (Property 17): one test per corrupted field (wrong type, missing field) names that field; parse error never touches any file
    - Example tests (Property 19): `generatedFor` near local midnight and across a DST change, output matches `YYYY-MM-DD`
    - Prerequisites: tasks 1 and 9.1
    - _Requirements: 10.8, 10.10, 12.1, 12.2, 12.3_

- [ ] 10. MP3 duration measurement
  - [ ] 10.1 Write the test MP3 builder `test/helpers/mp3.ts`
    - Deterministic builder from real frame headers, taking format from `ASSUMED_TTS_AUDIO_FORMAT`
    - Default variants: (a) bare frames; (b) ID3v2.3 with padding and a body containing `0xFF 0xFB` false syncs; (c) ID3v1 trailer containing `0xFF 0xFB`; (d) ID3v2 plus ID3v1, which is the DEFAULT fake TTS output; (e) truncated final frame; (f) garbage after the last frame; (g) VBR with changing bitrates
    - Non-default variants: (h) MPEG-1 Layer III 44.1 kHz stereo; (i) MPEG-2 Layer III 22.05 kHz mono
    - Prerequisite: task 4.1
    - _Requirements: 9.8, 14.5_

  - [ ] 10.2 Implement `measureMp3DurationSeconds` in `src/publish/duration.ts`
    - Hand-parsed frame headers, no dependency, following rules (a) to (g) in design.md: skip ID3v2 (syncsafe size check, footer, stacked tags), ignore ID3v1 trailer, confirm the first frame, contiguous frames with no resync, MPEG-1 1152 versus MPEG-2/2.5 576 samples per frame, unsupported streams return `unmeasurable`
    - Prerequisite: task 4.1
    - _Requirements: 9.8, 9.9, 9.10_

  - [ ] 10.3 Write example tests for duration measurement
    - Variants (a) to (d) built from the same frames all report the same known duration; (e) does not count the truncated frame; (f) ignores trailing garbage; (g) VBR sums per frame; (h) and (i) measure correctly from their own headers (Property 15 by examples only)
    - Doubling regression: the default-fake MP3 of about 35 seconds measures about 35 seconds, not about 70, and is rejected under `MIN_EPISODE_SECONDS`
    - Format-drift smoke test: the first frame header of the default fake's MP3 has version, layer, sample rate and channel mode equal to `ASSUMED_TTS_AUDIO_FORMAT`
    - Unmeasurable cases: Layer II, free-format bitrate, reserved values, ID3 size over buffer, empty buffer
    - Duration floor boundaries at 59, 60 and 61 seconds
    - Prerequisites: tasks 1, 10.1 and 10.2
    - _Requirements: 9.8, 9.9, 9.10, 14.5_

- [ ] 11. Script assembly
  - [ ] 11.1 Implement `assembleScript` in `src/publish/assemble.ts` and write example tests
    - Pure: intro Template_Text, Survivor Story_Scripts in selection order, outro Template_Text; outlet and date stated once in the intro; covered dates in the intro when the Selector widened; "short briefing today" intro when 1 or 2 Survivors remain
    - Example tests for the 3, 2 and 1 survivor intros and the widened-dates intro
    - Prerequisites: tasks 1 and 4.1
    - _Requirements: 6.4, 9.1, 9.2, 9.3, 9.5_

- [ ] 12. Checkpoint - pure cores complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Adapters
  - [ ] 13.1 Implement `src/lib/http.ts` and the Logger
    - `http.ts`: every network call goes through it, with timeout, `HTTP_RETRY_COUNT` retries, typed error, `AbortSignal` support
    - Logger in `src/lib/log.ts`: structured JSON lines, `briefingId` on every line, stage name, outcome, elapsed ms, typed error code on failure, never writes secrets
    - Prerequisite: task 4.1
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 15.4, 1.4_

  - [ ] 13.2 Create the network-disabling test harness
    - Vitest setup file that makes any real network attempt (global `fetch`, `http`, `https`, `net`) fail the test, instead of relying on the absence of a network
    - Include a self-test that a `fetch` call fails under the harness
    - Wire it into the Vitest config so every test runs under it
    - Prerequisites: tasks 1 and 2
    - _Requirements: 14.2, 14.5, 14.6_

  - [ ] 13.3 Implement `src/ingest/ingest.ts` and write example tests
    - `parseFeed(xml)` using `rss-parser` returns valid items plus `skipped` (`missing-field` or `bad-date`); `fetchFeed` uses `http.ts`; reads only `content:encoded` and requests no article page
    - Example tests parse `content/fixtures/synthetic-3-items.xml` into three items. Skipped-item cases (missing `guid`, missing `content:encoded`, bad `pubDate`) are built by modifying the fixture's text in memory, not by a second fixture file
    - Fetch failure after retry returns a typed error, using a fake `HttpClient`
    - Prerequisites: tasks 1, 5.3, 13.1 and 13.2
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 13.4 Implement `src/summarize/summarize.ts`, `prompt.ts` and the fake LLM, and write example tests
    - `summarize(sourceText, targetWords, llm, signal)` returns `Result<string, SummarizeError>`; one non-streaming call per item per pass; prompt text only in `prompt.ts`, built from the opening paragraphs plus one impact sentence; pass 1 target 85 always
    - `LlmAdapter` interface with a fake implementation for tests; real provider adapter behind the same interface, credentials from environment only
    - Example tests: prompt contains opening paragraphs and impact sentence, not a whole-article compression request; target 85 for 1, 2 and 3 items; LLM failure after retry gives a typed error; abort signal propagates
    - Prerequisites: tasks 1, 13.1 and 13.2
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.7_

  - [ ] 13.5 Implement `src/tts/tts.ts` with the fake adapter and the pinned Polly request, and write example tests
    - `TtsAdapter` interface; fake adapter returns default MP3 variant (d) (about 35 seconds) built from `ASSUMED_TTS_AUDIO_FORMAT`
    - Polly adapter request builder sets `OutputFormat` `"mp3"`, `Engine` `"neural"` and `SampleRate` equal to `String(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz)` on every request; one non-streaming call; credentials from environment only; typed `TtsError` on failure
    - Example tests with a fake Polly client: `Engine` is `"neural"` and `SampleRate` is `"24000"`; changing the constant changes the request; failure after retry gives a typed error
    - Prerequisites: tasks 1, 10.1, 13.1 and 13.2
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 14.5_

- [ ] 14. Checkpoint - adapters complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Orchestration
  - [ ] 15.1 Implement `src/pipeline/lock.ts` and write example tests
    - `acquireLock` with exclusive create (`wx`) and `{ pid, startedAtMs, buildId }`; `releaseLock`; `isStale` (older than budget plus grace); `reclaimStaleLock` writes a new `buildId`; `assertOwnsLock` re-reads the lock and compares `buildId`
    - Example tests: no lock; held and fresh (skip tick, logged); held and stale (reclaim, reclamation logged with old `buildId` and age); two concurrent acquires, one wins; `assertOwnsLock` fails after a reclaim; config test that `BUILD_BUDGET_SECONDS + BUILD_LOCK_GRACE_SECONDS < 1200` and `BUILD_BUDGET_SECONDS <= 600`
    - Use temp directories only
    - Prerequisites: tasks 1, 4.1 and 13.1
    - _Requirements: 11.9, 11.10, 11.12, 11.13_

  - [ ] 15.2 Implement `src/publish/publish.ts` and write example tests
    - `publish(episode, mp3, dir)`: write MP3 to a temp name and rename, then the Episode_JSON to a temp name and rename; MP3 always before JSON; only this module writes Episode files; calls `assertOwnsLock` immediately before each rename and aborts with a typed error, writing nothing, if ownership was lost
    - Example tests (temp directory): MP3 renamed before JSON; no partial file visible; ownership lost before publish writes nothing and leaves the previous Episode intact; reading an invalid Episode_JSON never modifies, deletes or rewrites it
    - Prerequisites: tasks 1, 9.1 and 15.1
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.10, 11.12_

  - [ ] 15.3 Implement `src/pipeline/run.ts`
    - Wire all 16 steps in design.md order: lock, ingest, normalize (log unknown tags, unclosed elements, unrecognised entities and invalid numeric references once per article), select, too-thin drop, pass 1, grounding, drop failures, pass 2 only for 1 or 2 survivors (targets 120 and 165) with one grounding check, length check, assemble, synthesize, measure duration, publish, release lock
    - Compare the new Selected_Set with the stored one; equal sets make no LLM or TTS call; absent Episode counts as an empty set; an empty selection publishes nothing
    - `AbortController` with `BUILD_BUDGET_SECONDS` deadline passed to every LLM and TTS call; log `buildDurationMs` and `exceededBudget` on every build end; publish-nothing rule on every stage failure
    - Import nothing from web player or telephony code
    - Prerequisites: tasks 5.3, 6.1, 6.2, 7.1, 8.1, 9.3, 10.2, 11.1, 13.3, 13.4, 13.5, 15.1 and 15.2
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.3, 8.4, 8.5, 9.8, 9.9, 9.10, 10.6, 11.2, 11.3, 11.4, 11.5, 11.7, 11.9, 11.11, 12.2, 13.1, 13.2, 13.4, 2.7, 2.14, 2.15_

  - [ ] 15.4 Implement `scripts/build-briefing.ts`
    - Cron entry point: build real adapters from config and environment, call `run`, exit code reflects outcome; no secrets in logs
    - Document the 20-minute cron schedule in a comment
    - Prerequisite: task 15.3
    - _Requirements: 11.1, 13.3, 15.1_

- [ ] 16. Pipeline-level example tests
  - [ ] 16.1 Write full-build example tests against the fixture
    - Fake LLM and fake TTS, feed read from `content/fixtures/synthetic-3-items.xml`, temp output directory, fixed `now`
    - 3 survivors: one LLM call per item, no pass 2, one TTS call, MP3 then JSON published, Episode_JSON matches schema and `generatedFor`
    - 2 survivors: pass 2 at 120 words with one grounding check; 1 survivor: pass 2 at 165 words; 0 survivors: nothing published; "short briefing today" intro used for 1 and 2
    - Item dropped as too-thin, grounding-failed and summarize-failed, each logged with `guid` and reason
    - Prerequisites: tasks 1 and 15.4
    - _Requirements: 4.2, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.5, 7.6, 9.1, 10.1, 10.2, 14.5_

  - [ ] 16.2 Write publish-nothing example tests
    - Each failure leaves the previously published Episode byte-identical: feed fetch failure, all items dropped, length floor (under 150 words), length ceiling exceeded, TTS failure, unmeasurable duration, duration under 60 seconds, LLM failure
    - "no new briefing today" outcome reported for the length floor
    - Prerequisites: tasks 1 and 15.4
    - _Requirements: 1.4, 8.4, 8.5, 9.6, 9.9, 9.10, 11.9_

  - [ ] 16.3 Write Selected_Set comparison example tests (Property 18)
    - Equal sets: zero LLM calls, zero TTS calls, Episode unchanged
    - Different sets: full run; no stored Episode counts as an empty set; empty selection publishes nothing and logs the outcome
    - Prerequisites: tasks 1 and 15.4
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.7_

  - [ ] 16.4 Write lock and deadline pipeline-level example tests
    - Lock held and fresh: the build skips the tick, makes no stage call, and logs the skip
    - Lock stale: reclaimed and logged, then the build proceeds
    - Ownership lost to a reclaim before publish: nothing written
    - Deadline abort using a fake `AbortSignal` that fires mid-LLM and mid-TTS (no real sleeping): the build ends under the publish-nothing rule, no partial file, `exceededBudget` logged
    - Every build end logs `buildDurationMs` and `exceededBudget`
    - Prerequisites: tasks 1 and 15.4
    - _Requirements: 11.9, 11.10, 11.11, 11.12_

- [ ] 17. Checkpoint - full pipeline tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Manual audit of real TTS output
  - [ ]* 18.1 Compare a real TTS MP3 with an independent tool
    - MANUAL and optional. Not part of the test suite. Run only after the real TTS adapter exists and credentials are available; commit no audio
    - Synthesize one real MP3, measure it with `measureMp3DurationSeconds`, and compare with `ffprobe`
    - Record the real MPEG version, layer, sample rate, channels, and bitrate mode (CBR or VBR, and the bitrate)
    - If any value differs from `ASSUMED_TTS_AUDIO_FORMAT`, update that constant (the default fake follows automatically) and re-run the tests
    - Prerequisite: task 13.5
    - _Requirements: 9.8, 14.5_

## Notes

- Tasks marked with `*` are optional. Only the manual audit (18.1) is optional; every test task is required.
- Exactly six property-based tests exist (Properties 8, 1, 9, 11, 13, 16 in tasks 4.3, 5.4, 6.3, 7.2, 8.2, 9.2). All other properties are covered by example tests per the design's Property test budget table.
- The fixture dependency: task 1 sits alone in wave 0 of the dependency graph, so every other task, including every test task, runs after it. Each test task also lists task 1 as a prerequisite.
- `scripts/fetch-fixture.ts` (task 3) is a manual-audit tool and no test reads it or its output.
- Requirement numbers refer to the current frozen `requirements.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3", "4.1"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1", "6.1", "6.2", "7.1", "8.1", "9.1", "10.1", "10.2"] },
    { "id": 5, "tasks": ["5.2", "6.3", "6.4", "7.2", "7.3", "8.2", "8.3", "9.2", "9.3", "10.3", "11.1"] },
    { "id": 6, "tasks": ["5.3"] },
    { "id": 7, "tasks": ["5.4", "5.5", "5.6"] },
    { "id": 8, "tasks": ["12"] },
    { "id": 9, "tasks": ["13.1", "13.2"] },
    { "id": 10, "tasks": ["13.3", "13.4", "13.5"] },
    { "id": 11, "tasks": ["14"] },
    { "id": 12, "tasks": ["15.1"] },
    { "id": 13, "tasks": ["15.2"] },
    { "id": 14, "tasks": ["15.3"] },
    { "id": 15, "tasks": ["15.4"] },
    { "id": 16, "tasks": ["16.1", "16.2", "16.3", "16.4"] },
    { "id": 17, "tasks": ["17"] },
    { "id": 18, "tasks": ["18.1"] }
  ]
}
```