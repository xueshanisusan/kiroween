# Kiroween Project

## What Is This?

## Implement Process

1. build steering files such as `product.md`, `structure.md` and `tech.md`
2. vibe, chat, brainstorm
3. vibe to spec: create a spec
4. requirement-first OR design-first?
5. requirement stage: *Analyze Requirements* button
6. write `design.md`: *Generate Tech Design* button
7. write `tasks.md`: *Generate Task List* button
8. implement
9. iterate using *Sync Files*

## Text-to-speech prerequisites (local)

The build speaks the script with local [Piper](https://github.com/rhasspy/piper) and encodes it with [ffmpeg](https://ffmpeg.org/).

1. Install ffmpeg and make sure `ffmpeg` is on your `PATH` (`ffmpeg -version` should work).
2. Install Piper and make sure `piper` is on your `PATH` (`piper --help` should work).
3. Download the voice model and its `.json` config into `models/piper/`. The default voice is `en_US-ryan-high` (files `en_US-ryan-high.onnx` and `en_US-ryan-high.onnx.json`, from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)).
4. To use other binary paths or another voice, edit `PIPER_BINARY`, `FFMPEG_BINARY`, `PIPER_VOICE_MODEL_DIR`, `VOICE_ID`, `TTS_SENTENCE_SILENCE_SECONDS` (0.3 s pause between sentences) and `TTS_RADIO_FILTER` (ffmpeg radio-style filter) in `src/config/index.ts`.

Still to do: listen to a built episode over a phone speaker outdoors to confirm the voice is intelligible.

## Production voice (Seed TTS)

There are two TTS engines behind one adapter, selected by `TTS_ENGINE` (read in `src/config/index.ts`):

- `piper` (default when `TTS_ENGINE` is unset): local Piper plus ffmpeg, described above. Used by tests and local runs.
- `seed`: ByteDance Seed Audio 1.0 (`bytedance-seed/seed-audio-1-0`) through OpenRouter, using the `@openrouter/sdk` package. This is the production demo voice.

Environment variables (see `.env.example`; `.env` is git-ignored, `.env.example` is committed):

| Variable | Meaning |
| --- | --- |
| `TTS_ENGINE` | `piper` or `seed`. Empty or unset means `piper`. |
| `OPENROUTER_API_KEY` | OpenRouter key. Needed only for `seed`. Environment only; never commit it. |
| `SEED_TTS_MODEL` | Model id. Defaults to `bytedance-seed/seed-audio-1-0`. |
| `SEED_TTS_VOICE` | Seed speaker id. Optional: when empty, the voice field is omitted and the API default voice is used. |

Notes:

- Tests and local runs never need credentials. The default engine is Piper, and tests use a fake client and never call Seed or the network.
- TTS spend happens only in the batch job `scripts/build-briefing.ts`. The web player and phone line only serve the published MP3. A build makes no TTS call when the selected story set is unchanged or when nothing is published.
- Schedule: run `scripts/build-briefing.ts` from cron every 20 minutes (for example `*/20 * * * *`, with `TTS_ENGINE=seed` and `OPENROUTER_API_KEY` set in the job's environment).
- Cost: OpenRouter bills per call, about $0.15 per minute of audio. A 60 to 120 s Episode costs roughly $0.15 to $0.30 (one build, one call).
- Still to do: the Seed speaker id has not been chosen. Pick it by listening test with the manual sample script `scripts/synthesize-seed-sample.ts` (task 19.5), then set `SEED_TTS_VOICE`. Also confirm the Seed voice is intelligible over a phone speaker outdoors.

## LLM mode (`LLM_MODE`)

The summarizer calls an LLM through `summarize/summarize.ts`. `LLM_MODE` (read in `src/config/index.ts`) selects how:

- `http` (default when `LLM_MODE` is unset): the existing HTTP LLM call through `src/lib/http.ts`.
- `kiro-cli`: runs the Kiro CLI as a subprocess instead of the HTTP call.

Using `kiro-cli`:

- Kiro CLI must be installed and on your `PATH`, and you must be logged in (`kiro-cli login`).
- It spends Kiro credits.
- It runs only in the batch job `scripts/build-briefing.ts`. The web player and phone line make no LLM call at request time.

Example: `LLM_MODE=kiro-cli npm run build-briefing`.

## Generate voice samples

Manual tools for choosing a voice. They are not part of the pipeline, and `models/` and `samples/` are git-ignored.

```
npx tsx scripts/fetch-voice.ts en_US-ryan-high
npx tsx scripts/make-voice-samples.ts en_US-ryan-high --pause 0.3 --radio
```

- `piper` and `ffmpeg` must be on your `PATH`.
- The first command downloads the voice into `models/piper/` and skips files that already exist. The second speaks `content/fixtures/voice-sample.txt` (invented text) and writes an MP3 to `samples/`, then prints its duration. `--radio` applies the radio filter; `--pause` sets the sentence pause in seconds.
- Browse voices at [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices). Check each voice's model card for its license before using it.
- `en_US-joe-medium` fails to synthesize on the current Piper build.

## Web player

The Web_Service is a small Node server (`node:http` only, no extra dependency) that plays the published briefing in a browser. It only serves what the Pipeline has already published. It never writes the data directory, makes no TTS or LLM call, and needs no credentials.

Start it:

```
npm install
npm start
```

Environment variables (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | TCP port, an integer from 1 to 65535. An invalid value stops startup. |
| `HOST` | `0.0.0.0` | Address to bind. |
| `BRIEFING_DATA_DIR` | `./data` | Directory holding the published `episode.mp3` and `episode.json`. |

Routes:

| Route | Returns |
| --- | --- |
| `/` | The player page: audio control, episode facts and a text transcript. |
| `/episode.json` | The published episode metadata. |
| `/episode.mp3` | The published audio, with HTTP range support. |
| `/healthz` | `{"status":"ok"}` whenever the service is up, with or without an episode. |

Publishing the episode:

- The one production build is run manually with the Seed voice: set `TTS_ENGINE=seed` and `OPENROUTER_API_KEY` in the shell, then run `npm run build-briefing` (this runs `scripts/build-briefing.ts`).
- The published `episode.mp3` and `episode.json` in `data/` (or `BRIEFING_DATA_DIR`) must be present on the host that runs `npm start`. If they are missing or invalid, the page shows the empty-state message that no briefing has been published yet.
- The server reads the files on each request, so a new build is served without a restart.

Public URL for the demo:

- The service binds `0.0.0.0` by default, so it accepts connections from outside the machine.
- The host must forward the port (default 8787, or the value of `PORT`) to the service, for example through a platform port mapping or a tunnel. Use the resulting public URL as the working app URL.

## Agent hooks

Two Kiro hooks are committed in `.kiro/hooks/`:

| File | Trigger | What it does |
| --- | --- | --- |
| `.kiro/hooks/block-sensitive-reads.json` | `PreToolUse` | Runs `scripts/hooks/guard-sensitive-reads.ts` before read-capable tools (file read, grep, file search, directory list, shell). If the call names a sensitive file such as `.env`, `.env.*` (not `.env.example`), keys, certificates or credentials files, the call is blocked and the agent gets a short message with no file content. A shell command that only names such a file (for example `git check-ignore .env`) is blocked too. |
| `.kiro/hooks/typescript-quality.json` | `PostFileSave` | After a `.ts` file under `src/`, `test/` or `scripts/` is saved, tells the agent to run `npm run typecheck` and the matching test file, fix failures, and check the file against the steering rules (named exports, no `any`, layering, config constants). |

To disable a hook, delete the file or rename it so it no longer ends in `.json` (for example `block-sensitive-reads.json.off`) under `.kiro/hooks/`. Start a new Kiro session for the change to take effect.

The sensitive-read hook lowers the chance that the agent reads secrets. It does not replace keeping secrets out of the repo:

- `.env` stays git-ignored. Only `.env.example` (variable names, no values) is committed.
- Hooks can be disabled, and other tools (an editor, a terminal, another agent) bypass them.
- A secret that was ever committed must be rotated. Removing it in a later commit does not remove it from history.

---

## How To Use KIRO

This section is for my fellow teammates.

Kiro's behavior is already configured in files under `.kiro/`, so you don't have to worry about prompting the behavior.

Read this before your first session:

### 1. What is in `.kiro/`

| Path | What it is | Who edits it |
| --- | --- | --- |
| `.kiro/steering/product.md` | Why the product exists, v1 scope, hard constraints, non-goals | Rarely, and deliberately |
| `.kiro/steering/tech.md` | Decided stack, provisional choices, forbidden patterns | When a technical decision changes |
| `.kiro/steering/structure.md` | Module layout and layering rules | When the shape of the code changes |
| `.kiro/specs/briefing-pipeline/` | requirements.md → design.md → tasks.md | Through the spec workflow only |
| `.kiro/hooks/` | Automated triggers (lint, guards, context injection) | When a workflow repeats |
| `docs/brief.md` | Scoping decisions and their reasoning. Not steering. | During scoping |

### 2. The order of operations

1. Spec: one spec per feature. When you want to implement a feature, click on the *Spec* button first!
2. Design: where trade-offs and rejected alternatives are recorded.
3. Tasks: run the first two or three one at a time and review each.

I also noticed Kiro IDE uses cloud sessions, so you have to commit and push `./kiro` **before** starting a cloud session.

### 3. Reviewing a spec

Do not read `requirements.md` line by line; you will waste a lot of time. Instead, ask the agent to audit its own output, and only judge the report. Here's an example prompt:

> Do not rewrite anything. Report:
> 1. Every acceptance criterion containing a subjective adjective (reasonable, appropriate, fast, sufficient). Quote the line.
> 2. Every requirement that touches something outside this spec's boundary.
> 3. A table of every number in requirements.md, what it constrains, and whether it matches the value in docs/brief.md.
> 4. Every acceptance criterion that cannot be checked without reading the implementation.

Then use the Review button on the file to leave inline comments to the specific paragraphs, and send them in one batch.

### 4. Known gaps

Kiro cannot automatically read the steering files. I wrote an `AGENTS.md` to include the steering files so Kiro has higher possibility to read the files -- but it's not always working. So when you start a new session, while Kiro generates its thinking and responses, keep an eye out on "did Kiro read the steering files?".

## Keep In Mind!

Here's something the event details said:

### What to submit

- select your category
- URL to your public GitHub
  - must contain all source code, assets, and instructions required for the project to be functional
  - must be public and open source by including an open source license file (maybe GPL)
  - must contain the `/.kiro` directory at the root of the project to show usage of specs, hooks, and steering
- URL to your working app
- text description that explains the features and functionality of your project
- demo video of your project
  - keep it under 3 minutes
  - show the project working on the device it was built for
  - upload it to YouTube and make it public
  - do not include third-party trademarks, copyrighted music, or other copyrighted material unless you have permission
- provide a write-up on how Kiro was used:
  - which Kiro product did you used?
  - did you create or use any custom agents? Which Kiro app did you try them in? How did they impact your builds?
  - what specific workflows did you automate with Kiro hooks? How did these hooks improve your development process?
  - how did you structure your spec for Kiro to implement? How did the spec-driven approach improve your development process? How did this compare to vibe coding?
  - how did you leverage steering to improve Kiro’s responses? Was there a particular strategy that made the biggest difference?
  - how did extending Kiro’s capabilities help you build your project? What sort of features or workflow improvements did MCP enable that otherwise would have been difficult or impossible?
  - did PBT help catch any issues you might have missed with unit tests? What kind of requirements did you enable PBT for?
  - which powers did you leverage for bundled best practices and expertise in Kiro? Did you use any third-party tooling or integrations you wouldn’t have otherwise?

### Bonus Prizes

- Best Startup Project: Confirm that you are a founder of the startup. Include your LinkedIn profile and startup website.
- Best Student Project: All team members must be students at a recognized academic institution. For each member, provide a LinkedIn profile, student email, year and degree, and school name. We may ask for proof of enrollment.
- Best Ghost of Kiroween Past: Confirm in your submission that you registered for Kiroween 2025. We will check this against Kiroween 2025 records. Your 2026 project must be new.
- Best Kiro Crew App: Provide the public URL to the GitHub repo for your Kiro Crew app. Describe its features and functionality.
- Social Blitz Prize: Post on any social platform during the Submission Period. Use the hashtag #KiroweenHackathon26 at the beginning of the post. Share your favorite thing about Kiro and how it changed the way you approach development. Add your post URL to your submission.
- Bonus Blog Prize: Publish a public blog post about Kiro and your project on any third-party blog platform during the Submission Period and mention it is being written as part of the Kiroween 2026 hackathon. Add the post URL to your submission.
- Best Demo: No extra steps. All eligible submissions are considered.