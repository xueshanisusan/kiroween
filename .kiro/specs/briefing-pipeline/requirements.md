# Requirements Document

## Introduction

The briefing-pipeline is the headless batch pipeline that turns the MIT News RSS feed into one spoken campus news briefing of at least 60 seconds. It covers ingest, selection, summarization, grounding, text-to-speech and publish. It is the only writer of episode files. It imports nothing from the web player or telephony features.

This spec follows `docs/brief.md` (v1), which agrees with the steering files in `.kiro/steering/`; if they ever disagree, `docs/brief.md` wins.

Out of scope: the web player, the Twilio webhook, keypad skip, article scraping, accounts, queues, databases and object storage.

Open decisions (voice provider, LLM provider) are hidden behind adapter interfaces, so these requirements do not depend on them.

## Glossary

- **Pipeline**: The batch process started by `scripts/build-briefing.ts` that produces an Episode.
- **Feed**: The RSS document at `https://news.mit.edu/rss/feed`, configured in `src/config/`.
- **Item**: One `item` element of the Feed, with `guid`, `title`, `pubDate` and `content:encoded`.
- **Ingestor**: The component that fetches the Feed and parses Items.
- **Normalizer**: The pure function that strips HTML tags from `content:encoded` and normalizes whitespace.
- **Source_Text**: The Normalizer output for one Item.
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
- **TTS_Adapter**: The interface with one implementation that turns a script into an MP3 in one offline call.
- **Publisher**: The component that concatenates Story_Scripts with Template_Text, requests audio, and writes the Episode files.
- **Episode**: The published result: one MP3 file and one Episode JSON file.
- **Episode_JSON**: The JSON file carrying `generatedFor`, the selected item IDs, and each story's Story_Script.
- **Episode_JSON_Schema**: The structure defined by the fields listed in criterion 10.2.
- **PROPERTY_TEST_RUNS**: The named constant 100, the number of fast-check runs per property (unit: runs).
- **HTTP_RETRY_COUNT**: The named constant 1, the number of retries for network, LLM and TTS calls (unit: retries).
- **MIN_EPISODE_SECONDS**: The named constant 60, the minimum measured MP3 duration of a published Episode (unit: seconds).
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

1. WHEN an Item body is normalized, THE Normalizer SHALL remove all HTML tags and decode HTML entities.
2. WHEN an Item body is normalized, THE Normalizer SHALL collapse every run of whitespace into one space and trim leading and trailing whitespace.
3. THE Normalizer SHALL perform no I/O and read no clock or random source.
4. FOR ALL strings, normalizing the output of the Normalizer SHALL produce the same output (idempotence).
5. FOR ALL strings, THE Normalizer output SHALL contain no `<` followed by a tag name and no whitespace run longer than one character.

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
7. THE Pipeline SHALL expose the TTS_Adapter and the LLM as interfaces with one implementation each.
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

1. THE repository SHALL contain `content/fixtures/synthetic-3-items.xml`, a hand-written RSS file with 3 Items.
2. THE repository SHALL contain `scripts/fetch-fixture.ts`, which downloads a Feed copy into `content/fixtures/`.
3. THE `.gitignore` file SHALL exclude `content/fixtures/*.xml` except `synthetic-3-items.xml`.
4. THE tests SHALL read only `synthetic-3-items.xml` from `content/fixtures/`.
5. THE test suite SHALL include property tests, using fast-check with at least PROPERTY_TEST_RUNS runs each, for the Length_Module and the Grounding_Checker.
6. THE test suite SHALL include a property test for the Selector and a round-trip property test for the Episode_JSON serializer and parser.
7. THE test suite SHALL run without network access and without LLM or TTS credentials, using fakes for the LLM and the TTS_Adapter. The fake TTS_Adapter SHALL return a real MP3 file with a known duration, so that tests exercise the same duration-measurement code path as production.

### Requirement 15: Configuration and dependency limits

**User Story:** As a maintainer adding a campus, I want campus values in config only, so that a new campus needs no module edits.

#### Acceptance Criteria

1. THE Pipeline SHALL read the campus name, Feed URLs, Campus_Timezone, voice id, greeting text, word targets, Too_Thin_Threshold, story count cap, PROPERTY_TEST_RUNS, HTTP_RETRY_COUNT and MIN_EPISODE_SECONDS only from `src/config/`, each declared with a unit comment.
2. WHERE an HTML-stripping dependency is used, THE repository SHALL record that dependency and its reason in `.kiro/steering/tech.md`.
3. THE Pipeline SHALL use no database, queue, broker, ORM, vector store or object storage.
4. THE Pipeline SHALL pass every network call through `src/lib/http.ts`, which applies a timeout, HTTP_RETRY_COUNT retries and a typed error.
5. THE Pipeline SHALL return `Result<T, E>` values at module boundaries.
