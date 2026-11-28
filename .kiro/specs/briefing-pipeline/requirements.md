# Requirements Document

## Introduction

The briefing-pipeline is the headless batch pipeline that turns the MIT News RSS feed into one spoken campus news briefing of at least 60 seconds. It covers ingest, selection, summarization, grounding, text-to-speech and publish. It is the only writer of episode files. It imports nothing from the web player or telephony features.

This spec follows `docs/brief.md` (v1), which agrees with the steering files in `.kiro/steering/`; if they ever disagree, `docs/brief.md` wins.

Out of scope: the web player, the Twilio webhook, keypad skip, article scraping, accounts, queues, databases and object storage.

Open decisions (LLM provider, and the Seed speaker id) are hidden behind adapter interfaces and configuration, so these requirements do not depend on them. The voice engine is decided: local Piper for tests and local runs, Seed TTS for the production demo (Requirement 16).

A reference such as 11.9 means criterion 9 of Requirement 11.

## Glossary

- **Pipeline**: The batch process started by `scripts/build-briefing.ts` that produces an Episode.
- **Feed**: The RSS document at `https://news.mit.edu/rss/feed`, configured in `src/config/`.
- **Item**: One `item` element of the Feed, with `guid`, `title`, `pubDate` and `content:encoded`.
- **Ingestor**: The component that fetches the Feed and parses Items.
- **Tag_Stripper**: The pure function that, in a single left-to-right pass over `content:encoded`, replaces each block-level tag with one space, deletes each other tag whose name is in the Known_Tag_Set, removes `script` and `style` elements and HTML comments together with their contents (each contributing nothing), and preserves literally any tag-shaped text whose name is not in the Known_Tag_Set. It is stage A1 of the Normalizer.
- **Known_Tag_Set**: A named constant, matched case-insensitively against the tag name, before any attributes: p, div, br, a, em, strong, b, i, code, span, sub, sup, cite, img, iframe, center, blockquote, h1, h2, h3, h4, h5, h6, ul, ol, li, table, tr, td, th, svg, path, g, script, style, section, article, figure, figcaption. The Block_Tag_Set is a subset of the Known_Tag_Set (section, article, figure and figcaption are listed so that this holds).
- **Block_Tag_Set**: A named constant, matched case-insensitively against the tag name: p, div, br, li, ol, ul, h1, h2, h3, h4, h5, h6, tr, td, th, table, blockquote, section, article, figure, figcaption, center.
- **Entity_Decoder**: The pure function that decodes character references in one pass over the Tag_Stripper output. It is stage B of the Normalizer.
- **Whitespace_Normalizer**: The pure function that collapses every run of whitespace into one space and trims leading and trailing whitespace. It is stage A2 of the Normalizer.
- **Normalizer**: The composition of the Tag_Stripper, then the Entity_Decoder, then the Whitespace_Normalizer, applied in that order to the `content:encoded` of one Item.
- **Source_Text**: The Whitespace_Normalizer output, which is the Normalizer output for one Item.
- **Selector**: The pure function in `select.ts` that chooses Items from a list, given `now`.
- **Campus_Timezone**: The IANA timezone from `src/config/` used to decide what "today" is.
- **Summarizer**: The component behind `summarize/summarize.ts` that asks the LLM for one Story_Script.
- **LLM**: The language model provider, hidden behind the Summarizer.
- **Story_Script**: The spoken text for one Item, stored as one row per story.
- **Template_Text**: The intro, outro and attribution line produced from fixed templates, not from the LLM.
- **Grounding_Checker**: The pure function that decides whether every checked token of a Story_Script appears in its Source_Text.
- **Checked_Token**: A numeric token, date expression or capitalized-word run extracted from a Story_Script, excluding Sentence_Starter_Stoplist entries.
- **Sentence_Starter_Stoplist**: The named constant list: The, This, That, It, But, And, However, Meanwhile, According, Today, Yesterday, Tomorrow, still, also, now.
- **Number_Lexicon**: The finite set of spelled-out numbers: two through ninety, hundred, thousand, million. "one" is excluded.
- **Survivor**: A Story_Script that passes the Grounding_Checker.
- **Length_Budget**: The word budget per story count: 3 stories = 20 intro + 3 x 85 + 15 outro = 290 words; 2 stories = 20 + 2 x 120 + 15 = 275 words; 1 story = 20 + 165 + 15 = 200 words, at 150 words per minute.
- **Length_Module**: The pure function in `length.ts` that computes word and character counts and checks them against the Length_Budget.
- **TTS_Adapter**: The interface that turns a script into one MP3 `Buffer` in one non-streaming call. It has one implementation per TTS_Engine value, and TTS_ENGINE selects exactly one of them in one place.
- **TTS_Engine**: One of the two values `'piper'` and `'seed'`.
- **TTS_ENGINE**: The named setting in `src/config/` that selects the TTS_Engine. Its default is `'piper'`.
- **Piper_Adapter**: The TTS_Adapter implementation for `'piper'`: local `piper` plus `ffmpeg`, used by tests and local runs.
- **Seed_Adapter**: The TTS_Adapter implementation for `'seed'`: ByteDance Seed Audio 1.0 (model `bytedance-seed/seed-audio-1-0`, non-streaming) called through the OpenRouter TypeScript SDK (`@openrouter/sdk`, `tts.createSpeech`), used for the production demo.
- **Seed_Credentials**: The OpenRouter API key (`OPENROUTER_API_KEY`) that the Seed_Adapter reads from the environment.
- **Speech_Client**: The minimal interface declared in `src/tts/seed.ts` with one method, `createSpeech`, that the `@openrouter/sdk` `tts` object satisfies and that tests replace with a fake object. Only the Seed_Adapter file (or one tiny factory beside it) imports the SDK.
- **Seed_Speaker_Id**: The Seed speaker id sent as the `voice` field of the request. Its value is chosen by listening test.
- **Published_Files**: The MP3 and the Episode_JSON that the Publisher last wrote.
- **Request_Handler**: A web player or telephony handler that answers a listener request by serving Published_Files. These handlers belong to other specs; this spec states the contract they must keep.
- **Publisher**: The component that concatenates Story_Scripts with Template_Text, requests audio, and writes the Episode files.
- **Episode**: The published result: one MP3 file and one Episode JSON file.
- **Episode_JSON**: The JSON file carrying `generatedFor`, the selected item IDs, and each story's Story_Script.
- **Episode_JSON_Schema**: The structure defined by the fields listed in criterion 10.2.
- **PROPERTY_TEST_RUNS**: The named constant 100, the number of fast-check runs per property (unit: runs).
- **HTTP_RETRY_COUNT**: The named constant 1, the number of retries for network, LLM and TTS calls (unit: retries).
- **MIN_EPISODE_SECONDS**: The named constant 60, the minimum measured MP3 duration of a published Episode (unit: seconds).
- **BUILD_BUDGET_SECONDS**: The named constant for the total time allowed for one build (unit: seconds), declared in `src/config/` with the other limits. Its value is 300 (unit: seconds). The value must be at most 600, so that the 20-minute cron interval plus BUILD_BUDGET_SECONDS does not exceed 30 minutes.
- **BUILD_LOCK_GRACE_SECONDS**: The named constant (unit: seconds) for the grace period added to BUILD_BUDGET_SECONDS before a held build lock is considered stale. Its value is 60 (unit: seconds).
- **generatedFor**: The campus-local date for which the Episode was built.
- **Selected_Set**: The set of Item IDs chosen by the Selector.
- **Too_Thin_Threshold**: The named constant 500 characters, the minimum Source_Text length.
- **Fixture**: `content/fixtures/synthetic-3-items.xml`, a hand-written RSS file used by tests.
- **Logger**: The component writing structured JSON log lines carrying `briefingId`.

## Requirements

### Requirement 1: Ingest the feed

**User Story:** As a campus news maintainer, I want the Pipeline to read the RSS feed, so that the briefing is built from current published items without scraping.

#### Acceptance Criteria

1. WHEN the Pipeline runs, THE Ingestor SHALL fetch the Feed URL from `src/config/` through `src/lib/http.ts`.
2. WHEN the Feed XML is received, THE Ingestor SHALL parse each Item into a typed record containing `guid`, `title`, `pubDate` and the `content:encoded` body.
3. THE Ingestor SHALL read article text only from `content:encoded` and SHALL make no request to any article page.
4. IF the Feed request fails after HTTP_RETRY_COUNT retries, THEN THE Ingestor SHALL return a typed error and THE Pipeline SHALL leave the published Episode unchanged.
5. IF an Item lacks `guid`, `pubDate` or `content:encoded`, THEN THE Ingestor SHALL skip that Item and log its title.
6. IF an Item `pubDate` cannot be parsed as a date, THEN THE Ingestor SHALL skip that Item and log its title.

### Requirement 2: Normalize article text

**User Story:** As a pipeline developer, I want HTML stripped from article bodies, so that the Summarizer and the Grounding_Checker work on clean text.

#### Acceptance Criteria

1. THE Tag_Stripper SHALL, in a single pass, replace each tag whose name (case-insensitive, in opening, closing or self-closing form) is in the Block_Tag_Set with a single space; SHALL delete every other tag whose name is in the Known_Tag_Set with no replacement (`script` and `style` elements are handled by criterion 2.13); and SHALL preserve literally any text that is not recognised as a tag under criterion 2.10, including tags with unknown names. Deleting an `img` tag also loses its data-caption text; this is acceptable because the caption is then absent from the Source_Text, which is both the LLM input and the Grounding_Checker reference, so the loss cannot cause a false rejection. Because the Tag_Stripper runs before the Entity_Decoder and deletes the whole `img` tag including its attributes, the caption text, and any character references inside the tag, never enter the Source_Text.
2. THE Whitespace_Normalizer SHALL collapse every run of whitespace into one space and trim leading and trailing whitespace, where whitespace includes U+00A0 so that `&nbsp;` and `&#160;` behave identically, and THE Whitespace_Normalizer SHALL run after the Entity_Decoder.
3. THE Tag_Stripper, THE Entity_Decoder and THE Whitespace_Normalizer SHALL each perform no I/O and read no clock or random source.
4. THE Pipeline SHALL apply the Tag_Stripper exactly once per article, and SHALL NOT re-run the Tag_Stripper on its own output or on Entity_Decoder output.
5. FOR ALL strings, every character of the Tag_Stripper output SHALL come from the input in the same order, except that each block-level tag contributes one space, each other known tag contributes nothing, and each `script` or `style` element and each HTML comment contributes nothing (the element or comment and its contents are removed); tag-shaped text not recognised under criterion 2.10 SHALL be preserved literally; and any `<` remaining in the output SHALL be a literal `<` as defined by criterion 2.10.
6. WHEN the Entity_Decoder meets a named character reference that is not in the fixed named-entity table, THE Entity_Decoder SHALL preserve that reference in its output exactly as it appeared in its input, and SHALL NOT remove it or replace it with an empty string. This preserves the Source_Text used by the Grounding_Checker, because dropping an entity would change the source and could cause false rejections and false passes.
7. THE Entity_Decoder, being pure (criterion 2.3), SHALL return the names of unrecognised named character references alongside its decoded output, and THE Pipeline SHALL log each unrecognised entity name once per article. The logging is done by the Pipeline because the Entity_Decoder performs no I/O.
8. WHEN the Entity_Decoder runs, THE Entity_Decoder SHALL decode the pinned entity set (numeric decimal references, numeric hexadecimal references, and the fixed named-entity table defined in the design document) in a single pass over the Tag_Stripper output, and SHALL NOT re-scan its own output. The Entity_Decoder output is an intermediate result that is passed to the Whitespace_Normalizer, not final text. THE Entity_Decoder SHALL decode `&nbsp;` to a plain space (U+0020).
9. THE Pipeline SHALL apply the stages in the order Tag_Stripper, Entity_Decoder, Whitespace_Normalizer, and this order SHALL be the only permitted order. THE Pipeline SHALL NOT pass Entity_Decoder output back to the Tag_Stripper, and only the Whitespace_Normalizer may follow the Entity_Decoder, so that source text such as `&lt;b&gt;`, which the Entity_Decoder decodes to the literal text `<b>`, is not later removed as a tag, which would silently lose content.
10. WHEN the Item body contains a `<` that is not the start of a tag, THE Tag_Stripper SHALL leave that `<` and the text after it unchanged, so that text such as "5 < 6" loses no content. A `<` is the start of a tag only if the tag name following it (after an optional `/`), taken as the maximal run of ASCII letters and digits and matched case-insensitively before any attributes, is in the Known_Tag_Set, AND a closing `>` is found. When THE Tag_Stripper looks for the closing `>` of a tag, THE Tag_Stripper SHALL skip over single-quoted and double-quoted attribute values, so that a `>` or `<` inside a quoted value does not end the tag or the search; the closing `>` is the first `>` outside a quoted value. This is required because the `img` caption must never reach the Source_Text (criterion 2.1): for example `data-caption="a > b"` must not end the tag at the first `>`. IF the closing `>` is not found before the next `<` outside a quoted value or before the end of the input (including an unterminated quote), THEN the `<` is literal text and THE Tag_Stripper SHALL leave it, together with the text after it, unchanged. A comment start `<!--` is not subject to the Known_Tag_Set test and is handled by criterion 2.13. The Tag_Stripper does not guess: unknown or malformed text is preserved, which is the same principle as the unknown-entity rule in criterion 2.6. This criterion is the single definition of the start of a tag.
11. FOR ALL strings, applying the Whitespace_Normalizer twice SHALL give the same result as applying it once (idempotence), and the Whitespace_Normalizer output SHALL contain no whitespace run longer than one character and no leading or trailing whitespace; THE Whitespace_Normalizer SHALL create no tag start that was not present in its input.
12. THE Pipeline SHALL use the Source_Text (the Whitespace_Normalizer output, which includes the single spaces inserted for block-level tags) for the Grounding_Checker, the Too_Thin_Threshold check and the input sent to the LLM. Word counting splits on whitespace, so block-tag spaces change counts by design.
13. THE Tag_Stripper SHALL remove each `script` and each `style` element together with its entire contents, from the opening tag through the matching closing tag (case-insensitive), and SHALL remove each HTML comment `<!-- ... -->` together with its entire contents, in every case without replacing it by a space, so that script, style or comment contents never reach the Source_Text. Note: `style` does not occur in the feed today (a `script` element does, an embedded social-media post); the rule exists so that its arrival is not a regression.
14. WHEN the body contains a tag-shaped sequence (a `<`, an optional `/`, a run of ASCII letters, then whitespace, `/` or `>`) whose name is not in the Known_Tag_Set, THE Tag_Stripper SHALL preserve it literally and SHALL return the unrecognised tag name alongside its output, and THE Pipeline SHALL log each such name once per article. The Tag_Stripper is pure (criterion 2.3), and the log is how a missing tag name is discovered.
15. IF a `script` or `style` opening tag, or an HTML comment opening `<!--`, has no matching closing tag (`</script>`, `</style>` or `-->`), THEN THE Tag_Stripper SHALL drop everything from that opening to the end of the article, and SHALL return the element name and the offset where it started alongside its output, and THE Pipeline SHALL log one line naming the element and that offset. The opening tag already shows that the markup is broken, and keeping the text would send code to the LLM. No special case is made for the result: if the remaining article is shorter than the Too_Thin_Threshold, the too-thin rule in criterion 6.2 drops the story.
16. THE Block_Tag_Set SHALL be a subset of the Known_Tag_Set, so that a block tag added to one list without the other cannot be left unrecognised.

### Requirement 3: Select stories by recency

**User Story:** As a listener, I want the briefing to cover the newest stories, so that old news is not presented as today's.

#### Acceptance Criteria

1. THE Selector SHALL take `now` as a parameter and SHALL NOT read the system clock.
2. WHEN Items exist with `pubDate` within the 48 hours before `now`, THE Selector SHALL select those Items ordered newest first, up to 3 Items.
3. IF fewer than 3 Items have `pubDate` within the 48 hours before `now`, THEN THE Selector SHALL widen the window to 7 days before `now` and select up to 3 Items, newest first.
4. WHEN the Selector widens the window, THE Selector SHALL return the covered dates, in Campus_Timezone, with the selection.
5. WHEN two Items have equal `pubDate`, THE Selector SHALL order them by `guid` ascending so that the result is deterministic.
6. THE Selector SHALL ignore Items with `pubDate` later than `now`.
7. FOR ALL Item lists and `now` values, THE Selector SHALL return at most 3 Items, each with `pubDate` not later than `now`, ordered by non-increasing `pubDate`.
8. IF no Item has `pubDate` within the 7 days before `now`, THEN THE Selector SHALL return an empty selection.

### Requirement 4: Summarize each story

**User Story:** As a listener, I want each story summarized from its opening and its impact, so that a short briefing still tells me what happened and why it matters.

#### Acceptance Criteria

1. WHEN an Item is summarized, THE Summarizer SHALL send the LLM the opening paragraphs of the Source_Text plus the one impact sentence chosen from the body, and SHALL NOT send a uniform compression request for the whole article.
2. WHEN the first pass runs, THE Summarizer SHALL request each Story_Script at a target of 85 words, regardless of whether the Selector returned 1, 2 or 3 Items.
3. THE Summarizer SHALL obtain each Story_Script from the LLM in one non-streaming call.
4. THE Summarizer SHALL keep prompt text in `summarize/prompt.ts`.
5. THE Summarizer SHALL store one Story_Script per Item.
6. IF the LLM call fails after HTTP_RETRY_COUNT retries, THEN THE Summarizer SHALL return a typed error for that Item and THE Pipeline SHALL treat the Item as dropped.
7. THE Summarizer SHALL state the outlet and date only in the intro Template_Text, and SHALL name a source inside a Story_Script only when attributing a specific claim.

### Requirement 5: Extract and check grounded tokens

**User Story:** As a listener, I want every number, date and name in the briefing to come from the article, so that the briefing never invents facts.

#### Acceptance Criteria

1. WHEN a Story_Script is checked, THE Grounding_Checker SHALL extract numeric tokens, including spelled-out numbers from the Number_Lexicon.
2. WHEN a Story_Script is checked, THE Grounding_Checker SHALL extract date expressions.
3. WHEN a Story_Script is checked, THE Grounding_Checker SHALL extract runs of capitalized words, excluding only tokens in the Sentence_Starter_Stoplist, at any position including the first word of a sentence.
4. THE Grounding_Checker SHALL define the Sentence_Starter_Stoplist as a named constant.
5. THE Grounding_Checker SHALL compare Checked_Tokens against the Source_Text of the same Item only.
6. THE Grounding_Checker SHALL compare names case-insensitively.
7. THE Grounding_Checker SHALL normalize numbers before comparison by stripping commas and currency symbols and unifying ordinals.
8. THE Grounding_Checker SHALL map each month name to one canonical form before comparison.
9. WHEN a Story_Script contains a weekday token that matches the weekday of the Item `pubDate` or appears literally in the Source_Text, THE Grounding_Checker SHALL accept that token.
10. WHEN every Checked_Token is found in the Source_Text, THE Grounding_Checker SHALL return a pass result.
11. IF any Checked_Token is not found in the Source_Text, THEN THE Grounding_Checker SHALL return a fail result listing the missing tokens.
12. THE Grounding_Checker SHALL be a pure function that calls no model, performs no I/O, and reads no clock.
13. FOR ALL Source_Texts, a Story_Script built only from entities present in that Source_Text SHALL pass the Grounding_Checker.
14. FOR ALL Story_Scripts that pass the Grounding_Checker, removing one entity from the Source_Text and re-checking a script that contained it SHALL produce a fail result.
15. THE Grounding_Checker SHALL NOT check Template_Text.

### Requirement 6: Drop failing and thin stories

**User Story:** As a listener, I want unreliable stories left out, so that everything I hear is traceable to the source.

#### Acceptance Criteria

1. IF a Story_Script fails the Grounding_Checker, THEN THE Pipeline SHALL drop that story and SHALL NOT substitute fallback text.
2. IF an Item Source_Text is shorter than the Too_Thin_Threshold, THEN THE Pipeline SHALL drop that Item before summarization.
3. WHEN a story is dropped, THE Logger SHALL record the Item `guid` and the reason (`too-thin`, `grounding-failed` or `summarize-failed`).
4. WHILE fewer than 3 Survivors remain and at least 1 Survivor remains, THE Publisher SHALL use the intro Template_Text that says "short briefing today".

### Requirement 7: Re-summarize when fewer than 3 survive

**User Story:** As a listener, I want a short briefing to still be long enough to be useful, so that two or one stories fill the time instead of leaving a few seconds of audio.

#### Acceptance Criteria

1. WHEN exactly 2 Survivors remain after the first pass (the Survivor count drives only this second pass), THE Summarizer SHALL re-summarize those 2 Items at a target of 120 words each.
2. WHEN exactly 1 Survivor remains after the first pass, THE Summarizer SHALL re-summarize that Item at a target of 165 words.
3. WHEN a Story_Script is re-summarized, THE Grounding_Checker SHALL check it once against the same Source_Text.
4. IF a re-summarized Story_Script fails the Grounding_Checker, THEN THE Pipeline SHALL drop that story.
5. THE Pipeline SHALL run no pass after the re-summarization pass.
6. WHEN the first pass leaves 3 Survivors or 0 Survivors, THE Pipeline SHALL make no re-summarization call.

### Requirement 8: Enforce the length budget

**User Story:** As a listener, I want the briefing to run at least 60 seconds and stay within its word budget, so that it is useful and still fits into a short walk.

#### Acceptance Criteria

1. THE Length_Module SHALL compute the word count of a text by splitting on whitespace.
2. THE Length_Module SHALL define the speaking rate of 150 words per minute and the story word targets as named constants in `src/config/`, each with a unit comment.
3. WHEN the final script is assembled, THE Length_Module SHALL compute the total word count of the intro, Story_Scripts and outro.
4. IF the total word count of the final script is below 150, THEN THE Pipeline SHALL publish no Episode and SHALL report "no new briefing today" as the build outcome. This 150-word floor is a cheap pre-check performed before synthesis and does not enforce the 60-second floor; the measured MP3 duration in Requirement 9 enforces that floor.
5. IF the total word count of the final script exceeds the Length_Budget for the final story count (290 for 3 stories, 275 for 2 stories, 200 for 1 story), THEN THE Pipeline SHALL publish no Episode and SHALL log a length-exceeded error.
6. THE Length_Module SHALL perform no I/O and read no clock or random source.
7. FOR ALL texts, THE Length_Module word count of the concatenation of two texts joined by one space SHALL equal the sum of the two word counts.
8. FOR ALL final scripts accepted by the Length_Module, the total word count SHALL be from 150 through the Length_Budget for the final story count, inclusive.

### Requirement 9: Assemble and synthesize the episode

**User Story:** As a listener, I want one continuous audio briefing, so that I can hear all stories without interaction.

#### Acceptance Criteria

1. WHEN at least one Survivor remains and the length check passes, THE Publisher SHALL concatenate the intro Template_Text, the Survivor Story_Scripts in selection order, and the outro Template_Text into one script.
2. THE Publisher SHALL state the outlet and the date once, in the intro Template_Text.
3. WHEN the intro states covered dates because the Selector widened the window, THE Publisher SHALL include those dates in the intro Template_Text.
4. WHEN the script is assembled, THE Publisher SHALL pass it to the TTS_Adapter, and THE TTS_Adapter SHALL return one MP3 file from one non-streaming call.
5. THE Publisher SHALL take the campus name, voice id and greeting text from `src/config/`.
6. IF the TTS_Adapter call fails after HTTP_RETRY_COUNT retries, THEN THE Pipeline SHALL leave the published Episode unchanged and log the error.
7. THE Pipeline SHALL expose the TTS_Adapter and the LLM as interfaces; the LLM has one implementation, and the TTS_Adapter has one implementation per TTS_Engine, selected in one place (Requirement 16).
8. WHEN the TTS_Adapter returns an MP3, THE Publisher SHALL measure the actual duration of that MP3 and log the measured duration, on every build.
9. IF the duration of the MP3 cannot be measured, THEN THE Pipeline SHALL count the duration check as failed, publish no Episode, and log the failure.
10. IF the measured MP3 duration is below MIN_EPISODE_SECONDS, THEN THE Pipeline SHALL publish no Episode and log the failure.

### Requirement 10: Publish episode files

**User Story:** As a downstream consumer that reads the published artefacts, I want a consistent published Episode on disk, so that I can read the latest briefing without calling the Pipeline.

#### Acceptance Criteria

1. WHEN an Episode is built, THE Publisher SHALL write the MP3 and the Episode_JSON to local disk.
2. THE Episode_JSON SHALL contain `generatedFor` as a campus-local date in Campus_Timezone, the Selected_Set item IDs, and for each story its `guid`, title and Story_Script.
3. THE Publisher SHALL write each file to a temporary name and rename it, so that a reader never sees a partial file.
4. THE Publisher SHALL write the MP3 before the Episode_JSON, so that published JSON never references a missing MP3.
5. THE Publisher SHALL be the only component that writes Episode files.
6. THE Pipeline SHALL import nothing from the web player or telephony modules.
7. FOR ALL objects that conform to the Episode_JSON_Schema referenced in criterion 10.8, serializing then parsing then serializing SHALL produce an equivalent object (round-trip property).
8. IF the Episode_JSON read from disk does not match the Episode_JSON schema, THEN THE parser SHALL return a typed error naming the invalid field.
9. THE Episode_JSON serializer SHALL produce JSON that the Episode_JSON parser accepts.
10. WHEN the parser returns a typed error for an Episode_JSON that fails schema validation, THE parser SHALL leave the invalid file on disk unchanged (no deletion, no quarantine, no rewrite).

### Requirement 11: Rebuild only when the selection changes

**User Story:** As a listener, I want a new story to be audible within 30 minutes of publication, so that the briefing stays current without needless rebuilds.

#### Acceptance Criteria

1. THE cron entry point `scripts/build-briefing.ts` SHALL run the whole Pipeline and be scheduled every 20 minutes.
2. WHEN the Pipeline runs, THE Pipeline SHALL compare the new Selected_Set with the Selected_Set stored in the published Episode_JSON.
3. WHEN the two Selected_Sets are equal, THE Pipeline SHALL make no LLM call and no TTS call and SHALL leave the published Episode unchanged.
4. WHEN the two Selected_Sets differ, THE Pipeline SHALL run summarization, grounding, synthesis and publish.
5. WHEN no Episode is published yet, THE Pipeline SHALL treat the stored Selected_Set as empty.
6. WHEN a new Item enters the Feed, THE Pipeline SHALL publish an updated Episode within 30 minutes, counting up to 20 minutes for the next cron run plus the build time.
7. IF the Selected_Set is empty, THEN THE Pipeline SHALL publish no new Episode and SHALL log the outcome.
8. No requirement in this spec enforces the 30-minute figure by alerting or escalation. The figure is an expectation under normal operation; 11.9 and 11.10 are the mechanisms that make it hold.
9. THE Pipeline SHALL enforce a total build budget given by BUILD_BUDGET_SECONDS. IF a build exceeds BUILD_BUDGET_SECONDS, THEN THE Pipeline SHALL abort the build and treat it as a failure under the publish-nothing rule: THE Publisher SHALL write no partial Episode file and the previously published Episode SHALL stay in place.
10. THE Pipeline SHALL allow at most one build to run at a time. IF a build is still running when the next cron tick fires, THEN THE Pipeline SHALL skip that tick and THE Logger SHALL log the skip. THE Pipeline SHALL NOT let two concurrent builds publish over each other.
11. WHEN a build ends, THE Logger SHALL write one structured log line containing `buildDurationMs` (unit: milliseconds) and `exceededBudget` (boolean). THE Pipeline SHALL take no alerting or escalation action based on that log line.
12. IF a build lock has been held longer than BUILD_BUDGET_SECONDS plus BUILD_LOCK_GRACE_SECONDS, THEN THE Pipeline SHALL treat the lock as stale, reclaim it, and write a log line naming the reclamation.
13. THE configured values SHALL satisfy BUILD_BUDGET_SECONDS + BUILD_LOCK_GRACE_SECONDS < the cron interval in seconds (1200), so that a crashed build costs at most one skipped cron tick.

### Requirement 12: Use the campus timezone for "today"

**User Story:** As a listener in the campus timezone, I want "today" to mean the campus day, so that the briefing date matches my local date.

#### Acceptance Criteria

1. THE Pipeline SHALL read Campus_Timezone from `src/config/`.
2. WHEN an Episode is built at instant `now`, THE Publisher SHALL set `generatedFor` to the calendar date of `now` in Campus_Timezone.
3. FOR ALL instants, THE `generatedFor` value SHALL be a valid `YYYY-MM-DD` date.

### Requirement 13: Observability

**User Story:** As a maintainer, I want one structured log line per stage, so that I can diagnose a failed build.

#### Acceptance Criteria

1. WHEN the Pipeline starts, THE Logger SHALL create a `briefingId` and attach it to every log line of that run.
2. WHEN a Pipeline stage (ingest, select, summarize, ground, tts, publish) finishes, THE Logger SHALL write one JSON line stating the stage name, the outcome and the elapsed time in milliseconds.
3. THE Logger SHALL write no secret value, such as an API key, to any log line.
4. IF a stage fails, THEN THE Logger SHALL write the failure with the stage name and the typed error code.

### Requirement 14: Fixtures and tests

**User Story:** As a maintainer, I want tests that use only committed synthetic data, so that the repository contains no MIT text and the checks stay reproducible.

#### Acceptance Criteria

1. THE repository SHALL gitignore real feed snapshots and commit only the synthetic fixture, that is, THE `.gitignore` file SHALL contain the rule `content/fixtures/*.xml` followed by the negation `!content/fixtures/synthetic-*.xml`, so that `synthetic-3-items.xml` is committed and every real snapshot is not.
2. THE tests SHALL read feed input only from the Fixture (the hand-written synthetic RSS file defined in the glossary), SHALL NOT read any real feed snapshot, and SHALL make no network request.
3. THE test suite SHALL include property tests, using fast-check with at least PROPERTY_TEST_RUNS runs each, for the Length_Module and the Grounding_Checker.
4. THE test suite SHALL include a property test for the Selector and a round-trip property test for the Episode_JSON serializer and parser.
5. THE test suite SHALL run without network access and without LLM or TTS credentials, using fakes for the LLM and the TTS_Adapter. The fake TTS_Adapter SHALL return a real MP3 file with a known duration, so that tests exercise the same duration-measurement code path as production.
6. THE test suite SHALL actively enforce that no network call occurs, using a network-disabling test harness or an assertion that fails the test on any network attempt, rather than relying on the absence of network access.
7. THE Tag_Stripper property test SHALL include the regression input `<<b>b>` with the expected output `<b>`, because it is the smallest input that fails a fixpoint-iterating stripper and a single-pass-idempotence claim. The first `<` has no `>` before the next `<`, so it is literal, and the inline tag `<b>` is deleted.
8. THE Normalizer test suite SHALL include the regression input `<p>end.</p><p>Next</p>` with the expected Source_Text "end. Next", and the property test for criterion 2.5 SHALL use it, so that adjacent block tags never merge words ("end.Next").
9. THE Normalizer test suite SHALL include the regression input `<p>a</p><script>var x = 1;</script><p>b</p>` with the expected Source_Text "a b" and with "var x" absent from the Source_Text.
10. THE Normalizer test suite SHALL include the regression input `x<y and y>z`, for which the Tag_Stripper output SHALL equal the input unchanged, the returned unrecognised tag names SHALL be exactly `y`, and THE Pipeline SHALL log `y` once; this is the case that exercises criterion 2.14 on text that is not a tag.
11. THE test suite SHALL include a property test that every member of the Block_Tag_Set is a member of the Known_Tag_Set.

### Requirement 15: Configuration and dependency limits

**User Story:** As a maintainer adding a campus, I want campus values in config only, so that a new campus needs no module edits.

#### Acceptance Criteria

1. THE Pipeline SHALL read the campus name, Feed URLs, Campus_Timezone, voice id, TTS_ENGINE, the Seed base URL, model and Seed_Speaker_Id defaults, greeting text, word targets, Too_Thin_Threshold, story count cap, PROPERTY_TEST_RUNS, HTTP_RETRY_COUNT, MIN_EPISODE_SECONDS, BUILD_BUDGET_SECONDS and BUILD_LOCK_GRACE_SECONDS only from `src/config/`, each declared with a unit comment.
2. WHERE an HTML-stripping dependency is used, THE repository SHALL record that dependency and its reason in `.kiro/steering/tech.md`.
3. THE Pipeline SHALL use no database, queue, broker, ORM, vector store or object storage.
4. THE Pipeline SHALL pass every network call through `src/lib/http.ts`, which applies a timeout, HTTP_RETRY_COUNT retries and a typed error.
5. THE Pipeline SHALL return `Result<T, E>` values at module boundaries.

### Requirement 16: TTS engines and Seed TTS adapter

**User Story:** As a maintainer, I want tests and local runs to use local Piper and the production demo to use Seed TTS, so that a clean checkout runs with no credentials and the demo voice has better quality.

#### Acceptance Criteria

1. THE `src/config/` module SHALL declare TTS_ENGINE with the allowed values `'piper'` and `'seed'` and the default `'piper'`.
2. WHEN TTS_ENGINE is `'piper'`, THE Pipeline SHALL build the Piper_Adapter, and WHEN TTS_ENGINE is `'seed'`, THE Pipeline SHALL build the Seed_Adapter, in one engine-selection function that is the only place that chooses an implementation.
3. IF TTS_ENGINE holds any value other than `'piper'` or `'seed'`, THEN THE Pipeline SHALL return a typed configuration error, make no TTS call and publish no Episode.
4. WHEN the Seed_Adapter synthesizes a script, THE Seed_Adapter SHALL make one non-streaming synthesis call per build through `tts.createSpeech` of the OpenRouter SDK, collect the returned byte stream into one audio `Buffer`, and return one MP3 `Buffer` to the Publisher.
5. THE Seed_Adapter SHALL provide, around the SDK call, a timeout (the named constant `SEED_TTS_TIMEOUT_MS`, unit milliseconds, applied through an `AbortSignal` combined with the build signal), up to HTTP_RETRY_COUNT retries only for HTTP 429, HTTP 5xx and timeout failures (never for HTTP 400, 401, 402, 403 or 404), and a typed `TtsError`, with the SDK's own retry disabled, because the SDK call is the one permitted exception to routing network calls through `src/lib/http.ts`.
6. THE Seed_Adapter SHALL pass a request object to `createSpeech` with `speechRequest` holding `model`, `input` (the script), `voice` (the Seed_Speaker_Id) and `responseFormat` set to `"mp3"` on every call.
7. WHEN the Seed_Adapter has collected the byte stream, THE Seed_Adapter SHALL pass the bytes through the same `ffmpeg` step as the Piper_Adapter, so that the published MP3 is MPEG-2 Layer III, 24000 Hz, mono, 48 kbit/s constant bitrate, as set by `ASSUMED_TTS_AUDIO_FORMAT`.
8. THE `src/config/` module SHALL declare one radio-filter constant per TTS_Engine, each with a unit or purpose comment; the `'piper'` constant SHALL equal `TTS_RADIO_FILTER`, and the `'seed'` constant SHALL default to no filter and SHALL be changeable without editing a module.
9. THE Seed_Adapter SHALL read Seed_Credentials from environment variables only and SHALL NOT place the API key in code, log lines or committed files.
10. IF TTS_ENGINE is `'seed'` and `OPENROUTER_API_KEY` is missing or empty, THEN THE Seed_Adapter SHALL return a typed `TtsError` of kind `missing-credentials` before any network request, and THE Pipeline SHALL publish no Episode.
11. THE `src/config/` module SHALL declare the model `SEED_TTS_MODEL` (default `bytedance-seed/seed-audio-1-0`), the Seed_Speaker_Id `SEED_TTS_VOICE` and `SEED_TTS_TIMEOUT_MS` as named constants, with the model and voice overridable by environment variables, each with a unit or purpose comment.
12. IF the OpenRouter service answers with HTTP status 401, 402, 429 or 5xx, an empty audio body, a timeout or an abort, THEN THE Seed_Adapter SHALL return a typed `TtsError` whose kind names the cause (`unauthorized` for 401, `insufficient-credits` for 402, `rate-limited` for 429, `server-error` for 5xx, `empty-audio`, `timeout`, `aborted`), and for any other non-2xx status the kind `http-status`, carrying the status code only and no response body that could echo a credential, and THE Pipeline SHALL publish no Episode.
13. THE repository SHALL document every Seed environment variable name in `README.md` and `.env.example`, with a placeholder and no real value in either file.
14. THE test suite SHALL test the Seed_Adapter only against a fake Speech_Client injected into the adapter, without importing or calling the real SDK, SHALL include example tests for the request object passed to `createSpeech` (`model`, `input`, `voice`, `responseFormat` `"mp3"`), collection of the byte stream into the audio buffer, error mapping (12) including 402 insufficient credits, retry only on retryable failures (11 and 12), the missing key (10) and engine selection by TTS_ENGINE, and SHALL make no real network call.
15. WHERE the SDK call exposes the `X-Generation-Id` response header, THE Seed_Adapter SHALL log its value once per build with the `briefingId`, and no log line SHALL contain the API key.
16. THE Seed_Speaker_Id SHALL be chosen by a listening test with `scripts/synthesize-seed-sample.ts` before the production demo (OPEN QUESTION in `.kiro/steering/product.md`); the endpoint, authentication and model are resolved.
### Requirement 17: Pre-generation and cost guards

**User Story:** As a maintainer paying for production TTS, I want audio generated only by the batch build and only when it is needed, so that spend stays bounded and listeners never wait for synthesis.

#### Acceptance Criteria

1. THE production build SHALL run from the cron entry point `scripts/build-briefing.ts` against the production Feed, once per campus per day and again whenever the Selected_Set changes (Requirement 11).
2. THE Pipeline SHALL make TTS calls only inside a build started by `scripts/build-briefing.ts`.
3. WHEN a Request_Handler answers a request, THE Request_Handler SHALL serve only the Published_Files and SHALL make no TTS call and no LLM call.
4. THE test suite SHALL include a test in which every Request_Handler that exists is built with a TTS_Adapter and an LLM adapter that throw when called, and in which each handler still serves the published Episode.
5. WHEN the new Selected_Set equals the stored Selected_Set, THE Pipeline SHALL make no TTS call (cost guard; see 11.3).
6. IF the Pipeline decides before synthesis to publish nothing (empty selection, no Survivor, final script under 150 words, or final script over the Length_Budget), THEN THE Pipeline SHALL make no TTS call.
7. THE Pipeline SHALL make one synthesis call per build, plus at most HTTP_RETRY_COUNT retries of that call after a failure.
8. THE test suite SHALL include example tests, with a counting fake TTS_Adapter, for 17.5, 17.6 and 17.7.
