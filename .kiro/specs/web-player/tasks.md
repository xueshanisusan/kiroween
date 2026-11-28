# Implementation Plan: web-player

## Overview

Implementation language is TypeScript (ESM, Node 22, Vitest, fast-check), as used in design.md. The plan starts with workspace hooks (TypeScript quality reminders and a sensitive-file read guard), then builds the web layer bottom-up: config, pure cores (Range_Parser, Page_Renderer), the Episode_Loader, route handlers, the request handler, the server entry point and start script, route-level tests, and finally the README.

Rules that apply to every task:
- NEVER read, print, grep, list the contents of, or copy `.env` (it exists in the repo root and holds secrets). Use `.env.example` if a variable name is needed. This applies to every task and every test in this plan.
- Hook files use the current Kiro v1 schema: `.kiro/hooks/<id>.json` containing `{"version": "v1", "hooks": [{ "name", "trigger", "matcher", "action" }]}` with PascalCase triggers (`PreToolUse`, `PostFileSave`). The older `*.kiro.hook` format (`when`/`then`, `fileEdited`, `askAgent`) is no longer executed and must not be used. A `PreToolUse` command hook blocks a tool call by exiting with code 2 and writing the reason to stderr; stdout is not shown to the agent.
- Hook files live in `.kiro/hooks/` and are committed (structure.md). The guard script lives under `scripts/hooks/`, and its test lives under `test/hooks/` because `vitest.config.ts` only includes `src/**` and `test/**`.
- The web layer adds no runtime dependency. It uses `node:http`, `node:fs`, `node:crypto` and `node:url` only (Requirement 11.4). The only `package.json` change is a `start` script.
- The web layer imports only `parseEpisode`, `EpisodeJson`, `EPISODE_MP3_FILE` and `EPISODE_JSON_FILE` from `src/publish/`, plus `src/config/`, `src/lib/` and `src/types.ts` (Requirements 11.1 to 11.3).
- Exactly six property-based tests exist: Properties 1 to 6 (tasks 4.2, 4.3, 4.4, 4.5, 6.2, 6.3). Each uses `PROPERTY_TEST_RUNS` as the run count, is a single test, and carries a `// Feature: web-player, Property N: ...` tag comment. Every other requirement is covered by example tests.
- All test tasks are required (not optional), following the briefing-pipeline convention. Only the manual hook check (task 1.6) is optional.
- Named exports only, no default exports, no `any`, `Result<T, E>` at boundaries, named constants with unit comments in `src/config/`.
- No test starts a real TTS or LLM call. The loopback server tests use an ephemeral port on `127.0.0.1`.

## Tasks

- [x] 1. Workspace hooks
  - [x] 1.1 Implement the sensitive-path guard
    - Create `scripts/hooks/sensitive-paths.ts`: a pure function `findSensitiveReference(text: string): string | null` that returns the matched pattern name, or `null`. No I/O, no clock
    - Normalize before matching: convert backslashes to forward slashes, lowercase, strip surrounding quotes, and collapse `./` and `a/../` segments, so `.\.env`, `D:\Programs\kiroween\.ENV` and `"src/../.env"` all match
    - Sensitive basenames and patterns: `.env`; `.env.*` except exactly `.env.example`; `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`; `id_rsa`, `id_ed25519`, `id_ecdsa` (and `.pub` is allowed); `credentials`, `credentials.json`, `.aws/credentials`; `.npmrc`, `.netrc`; `service-account*.json`; `secrets.json`, `secrets.yaml`, `secrets.yml`
    - Match on path segments or whole shell tokens, not substrings, so `src/config/environment.ts`, `.env.example` and `monkey.ts` are allowed
    - Create `scripts/hooks/guard-sensitive-reads.ts`: reads the hook JSON payload from stdin, recursively collects every string value in `tool_input` (also accepts `toolArgs`), and runs `findSensitiveReference` on each. If the stdin is empty or not JSON, scan the raw stdin text instead (fail closed on the text, never throw)
    - On a match: write one clear line to stderr (for example `Blocked: this tool call would read a sensitive file (<pattern>). Secrets must not enter the agent context. Use .env.example for variable names.`) and exit with code 2. Never echo the matched file's content. Otherwise exit 0 with no output
    - Run with `npx tsx scripts/hooks/guard-sensitive-reads.ts`
    - _Requirements: 9.6_
  - [x] 1.2 Create the sensitive-read hook file
    - Create `.kiro/hooks/block-sensitive-reads.json` with `version: "v1"` and one hook: `trigger: "PreToolUse"`, `matcher` a regex over read-capable tool names: `^(read_file|read_code|grep_search|file_search|list_directory|execute_pwsh|readFile|readCode|grepSearch|fileSearch|listDirectory|executePwsh)$`, `action: { "type": "command", "command": "npx tsx scripts/hooks/guard-sensitive-reads.ts" }`, and a `timeout` of 30 seconds
    - `execute_pwsh` is included so `cat .env`, `type .env` and `Get-Content .env` are blocked. Note in the hook description that a shell command that merely names a sensitive file (for example `git check-ignore .env`) is also blocked, and that this is accepted
    - Prerequisite: task 1.1
    - _Requirements: 9.6_
  - [x] 1.3 Test the sensitive-path guard
    - Create `test/hooks/sensitive-paths.test.ts` with example tests: `.env`, `.\.env`, `D:\Programs\kiroween\.env`, `.ENV`, `./src/../.env`, `.env.local`, `.env.production`, `certs/server.pem`, `deploy.key`, `id_rsa`, `.aws/credentials`, `credentials.json`, `service-account-prod.json`, and shell strings `cat .env`, `Get-Content .\.env` all return a match
    - Allowed: `.env.example`, `src/config/environment.ts`, `src/web/server.ts`, `README.md`, `package.json`, `keyboard.ts`, `id_rsa.pub`
    - Spawn `guard-sensitive-reads.ts` with `node --import tsx` (or `npx tsx`) and a stdin payload such as `{"tool_name":"read_file","tool_input":{"path":".env"}}`: assert exit code 2 and a non-empty stderr; assert exit code 0 and empty stderr for `{"tool_input":{"path":".env.example"}}`; assert exit code 2 for a grep payload `{"tool_input":{"query":"KEY","includePattern":"**/.env"}}`; assert exit code 0 for empty stdin and for a malformed payload with no sensitive text
    - The tests use path strings only. They never open the real `.env` file, and no assertion prints a file's content
    - Prerequisite: task 1.1
    - _Requirements: 9.6_
  - [x] 1.4 Create the TypeScript quality hook
    - Create `.kiro/hooks/typescript-quality.json` with one hook: `trigger: "PostFileSave"`, `matcher: "(^|[\\\\/])(src|test|scripts)[\\\\/].*\\.ts$"`, and an `agent` action whose static prompt tells the agent to: run `npm run typecheck`, then run `npx vitest --run` on the test file for the saved module (the sibling `*.test.ts`, or `test/**` equivalent), and fix failures before continuing; and to check the saved file against these steering rules: named exports only, no default exports, no `any`, `Result<T, E>` at boundaries (throw only for programmer error), layers import downward only (`ingest → summarize → tts → publish`, telephony and web read `publish` and never the reverse; `src/web/` must not import `ingest`, `summarize`, `tts`, `select`, `ground`, `length` or `pipeline`), campus values and tunable constants in `src/config/` with a unit comment, no new runtime dependency, no network call outside `src/lib/http.ts` (Seed adapter excepted)
    - The prompt must also say: never read `.env`
    - Use `agent` (not `command`) so the reminder reaches the model. A command hook's stdout is not forwarded for this trigger
    - _Requirements: 11.5, 11.6_
  - [x] 1.5 Document the hooks in the README
    - Add a short "Agent hooks" section to `README.md` listing the two hook files, what each does, and how to disable one (delete or rename the file under `.kiro/hooks/`)
    - State plainly that the hooks reduce the chance of the agent reading secrets but do not replace keeping secrets out of the repo: `.env` stays gitignored, only `.env.example` is committed, hooks can be disabled or bypassed by other tools, and a secret that was ever committed must be rotated
    - Do not open or quote `.env` while writing this section
    - Prerequisite: tasks 1.2 and 1.4
    - _Requirements: 9.6, 13.3_
  - [x] 1.6 Manual check that the guard blocks reads
    - Start a new Kiro session so the hooks load. Create a throwaway file `tmp-hook-check/dummy.pem` containing the text `not-a-real-secret`, and ask the agent to read it with `read_file` and with `grep_search`. Expect the blocked message from task 1.1 each time and no file content
    - Do NOT test against the real `.env`. Delete `tmp-hook-check/` afterwards
    - Confirm `.kiro/hooks/*.json` are not gitignored: run `git check-ignore .kiro/hooks/block-sensitive-reads.json` and expect no output
    - Prerequisites: tasks 1.2 and 1.3
    - _Requirements: 9.6_

- [x] 2. Checkpoint - Hooks in place
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 3. Web config and constants
  - [x] 3.1 Add Web_Config to `src/config/`
    - Add `WebConfig`, `WEB_CONFIG` and `WEB_DEFAULT_PORT` to `src/config/index.ts` exactly as in design.md Data Models: `outletName`, `pageTitle`, `emptyStateMessage`, `audioLabel`, `jsonCacheMaxAgeSeconds` (60, seconds), `headerTimeoutMs` (10000, milliseconds), `idleTimeoutMs` (30000, milliseconds); `WEB_DEFAULT_PORT` 8787 (port number, 1 to 65535)
    - Derive the outlet name and titles from the existing `CAMPUS_NAME` constant. Every constant carries a unit comment
    - Add `WEB_DEFAULT_HOST` as `"0.0.0.0"` and reuse the existing `./data` default for `BRIEFING_DATA_DIR` used by the Pipeline (find the existing constant, do not duplicate it)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 3.3_
  - [x] 3.2 Write config example test
    - Create `src/config/web-config.test.ts`: every text field is a non-empty string, timeouts and cache lifetime are positive integers, `WEB_DEFAULT_PORT` is an integer from 1 to 65535, and the empty-state message states in plain English that no briefing has been published yet
    - Prerequisite: task 3.1
    - _Requirements: 9.1, 3.3_

- [x] 4. Range_Parser
  - [x] 4.1 Implement `src/web/range.ts`
    - Export `parseRange(headerValue, sizeBytes)` returning `RangeResult` (`satisfiable` | `unsatisfiable` | `not-a-range`) and `formatRange({ start, end })` returning `bytes=<start>-<end>`, per design.md
    - `undefined` or no `bytes=` prefix gives `not-a-range`. More than one comma-separated range, a syntactically invalid range, or `start >= sizeBytes` (including `sizeBytes === 0`) gives `unsatisfiable`. Open end ends at `size - 1`. Suffix form returns the last `length` bytes, or the whole file when `length >= size`. A closed-form end at or beyond `size` is clamped to `size - 1`
    - Pure: no I/O, no clock, no randomness. Named exports only
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 12.2, 12.8_
  - [x] 4.2 Write property test for satisfiable ranges (Property 1)
    - **Property 1: Satisfiable ranges are well-formed and clamped**
    - `// Feature: web-player, Property 1: Satisfiable ranges are well-formed and clamped`
    - Create `src/web/range.property.test.ts`. Generate `size > 0` and closed, open-ended and suffix headers whose requested end may exceed `size`. Assert `0 <= start <= end < size` and that an end past the file clamps to `size - 1`
    - Prerequisite: task 4.1
    - **Validates: Requirements 5.3, 5.4, 5.6, 12.3**
  - [x] 4.3 Write property test for classification (Property 2)
    - **Property 2: Unsatisfiable and not-a-range classification**
    - `// Feature: web-player, Property 2: Unsatisfiable and not-a-range classification`
    - Add to `src/web/range.property.test.ts`. Generate non-`bytes=` strings, multi-range strings, invalid single ranges and `start >= size` ranges, and assert `not-a-range` or `unsatisfiable` as specified
    - Prerequisite: task 4.2
    - **Validates: Requirements 5.5, 5.7, 12.8**
  - [x] 4.4 Write property test for byte count (Property 3)
    - **Property 3: Range response byte count matches the parsed range**
    - `// Feature: web-player, Property 3: Range response byte count matches the parsed range`
    - Add to `src/web/range.property.test.ts`. For every `satisfiable` result, slice a fixture buffer of `size` bytes with `[start, end + 1)` and assert its length equals `end - start + 1`. No real Data_Dir file
    - Prerequisite: task 4.3
    - **Validates: Requirements 12.4**
  - [x] 4.5 Write property test for the round trip (Property 4)
    - **Property 4: Range header round-trip**
    - `// Feature: web-player, Property 4: Range header round-trip`
    - Add to `src/web/range.property.test.ts`. Generate `size`, `start`, `end` with `0 <= start <= end < size`; assert `parseRange(formatRange({ start, end }), size)` equals `{ kind: "satisfiable", start, end }`
    - Prerequisite: task 4.4
    - **Validates: Requirements 12.7**

- [x] 5. Episode_Loader
  - [x] 5.1 Implement `src/web/episode-loader.ts`
    - Export `loadEpisode(dataDir)` returning `Result<PublishedEpisode, EpisodeLoadError>` per design.md. One `readFileSync` of `episode.json` and one `statSync` of `episode.mp3` per call, using `EPISODE_JSON_FILE` and `EPISODE_MP3_FILE` from `src/publish/`
    - Missing file or missing Data_Dir gives `{ kind: "no-episode" }`. `parseEpisode` failure gives `{ kind: "invalid-field", field, message }`. Missing or zero-byte MP3 gives `{ kind: "empty-mp3" }`. No call throws for these cases
    - Import no write-side function from `src/publish/`. Never write, rename or delete anything
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 6.1, 6.4, 11.1, 11.3, 11.5_
  - [x] 5.2 Write Episode_Loader example tests
    - Create `src/web/episode-loader.test.ts` using temporary directories and the existing `test/helpers/mp3.ts` builder: valid pair, missing Data_Dir, missing json, missing mp3, zero-byte mp3, corrupt json naming the invalid field, and a pair replaced between two calls (the second call sees the new episode)
    - Prerequisite: task 5.1
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 14.2, 14.3_

- [x] 6. Page_Renderer
  - [x] 6.1 Implement `src/web/render.ts`
    - Export `renderPage(input, text)`, `escapeHtml(value)`, `RenderInput` and `PageText` per design.md. `escapeHtml` escapes `& < > " '` and is the only path by which an Episode_JSON string reaches the output
    - `published` branch inside `<main>`, in order: `<audio controls preload="metadata" aria-label=...>` with `src="/episode.mp3"` and a fallback link to `/episode.mp3` inside the element, then Episode_Facts (outlet name and `generatedFor`), then one `<h2>` plus one `<p>` per story in `stories` order. `empty` branch: no `<audio>`, the Empty_State_Message as visible text
    - `<html lang="en">`, a non-empty `<title>`, exactly one `<h1>`, no `tabindex`, no external resources, no `<style>` element, no script
    - Pure: no `fs`, no clock, no randomness
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.2, 12.1_
  - [x] 6.2 Write property test for escaping (Property 5)
    - **Property 5: Rendered output escapes every Episode_JSON value**
    - `// Feature: web-player, Property 5: Rendered output escapes every Episode_JSON value`
    - Create `src/web/render.property.test.ts`. Generate `EpisodeJson` values with string generators biased toward `<`, `>`, `&`, `"`, `'` and literal `<script>` substrings in `title`, `script` and `generatedFor`. Assert none of those characters appears unescaped as markup. Include the literal `<script>alert(1)</script>` as a `fc.examples` case
    - Prerequisite: task 6.1
    - **Validates: Requirements 2.7, 12.5**
  - [x] 6.3 Write property test for page structure (Property 6)
    - **Property 6: Rendered output has fixed structural shape**
    - `// Feature: web-player, Property 6: Rendered output has fixed structural shape`
    - Add to `src/web/render.property.test.ts`. Generate `EpisodeJson` values with 0 to 5 stories (including empty-string titles and scripts). Assert exactly one `<h1`, exactly one `<audio controls` and exactly `n` story headings for `published`; exactly one `<h1` and zero `<audio` for `empty`
    - Prerequisite: task 6.2
    - **Validates: Requirements 2.2, 3.2, 12.6**
  - [x] 6.4 Write renderer example tests
    - Create `src/web/render.test.ts`: the `<script>alert(1)</script>` script body renders no executable script element (14.5); the audio element appears before the transcript and both are inside `<main>`; `preload="metadata"`; `lang="en"`; fallback link inside `<audio>`; the output contains no `http://` or `https://` resource reference, no `<style>`, no `<script`, no `tabindex`; the empty page contains the Empty_State_Message
    - Prerequisite: task 6.1
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.1, 2.3, 2.4, 2.9, 2.10, 3.1, 14.5_

- [x] 7. Checkpoint - Pure cores and loader
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Route handlers
  - [x] 8.1 Implement shared route pieces under `src/web/routes/`
    - `route-types.ts`: `RouteResult` and the route context type from design.md
    - `etag.ts`: strong quoted sha1 `ETag` of file bytes; for the MP3 cache by `(path, mtimeMs, size)` so range requests do not re-hash. `matchesIfNoneMatch(header, etag)`
    - `healthz.ts` (status 200, body `{"status":"ok"}` regardless of episode state), `not-found.ts` (404, `{"error":"not-found"}`), `method-not-allowed.ts` (405 with `Allow: GET, HEAD`, `{"error":"method-not-allowed"}`)
    - _Requirements: 4.4, 5.11, 8.2, 8.3, 8.4_
  - [x] 8.2 Implement `src/web/routes/root.ts`
    - Call `loadEpisode`, map to `RenderInput`, call `renderPage`, respond 200 `text/html; charset=utf-8` with `Content-Length` (no chunked encoding). `HEAD` returns the same status and headers with `body: null`. On an `EpisodeLoadError`, serve the empty page (200) and report the error kind (and field for `invalid-field`) to the handler for logging, never the parse message
    - Prerequisites: tasks 5.1, 6.1, 8.1
    - _Requirements: 1.1, 1.7, 3.1, 3.4, 3.5, 3.6, 7.5, 10.6_
  - [x] 8.3 Implement `src/web/routes/episode-json.ts`
    - Serve the raw file bytes (not a re-serialized object) with `application/json; charset=utf-8`, `Cache-Control: max-age=<WEB_CONFIG.jsonCacheMaxAgeSeconds>` and a strong `ETag`. Matching `If-None-Match` gives 304 with no body. A missing episode gives 404 `{"error":"no-episode"}`. `HEAD` gives the same headers and no body
    - Prerequisites: tasks 5.1, 8.1
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.4_
  - [x] 8.4 Implement `src/web/routes/episode-mp3.ts`
    - Use `statSync` on the opened file, then `fs.createReadStream` (never read the whole file into memory). No `Range` or `not-a-range`: 200, `audio/mpeg`, `Content-Length`, `Accept-Ranges: bytes`. `satisfiable`: 206 with `Content-Range: bytes <start>-<end>/<size>`, `Content-Length: end - start + 1` and a stream opened with `{ start, end }`. `unsatisfiable`: 416 with `Content-Range: bytes */<size>` and no body. Sizes come from the file handle being streamed
    - Strong `ETag` and `If-None-Match` 304 as in 8.1. Missing episode gives 404 `{"error":"no-episode"}`. `HEAD` mirrors `GET` headers with no body. Return the served `rangeStart` and `rangeEnd` for logging
    - On client abort, destroy the stream and stop writing, so other requests are unaffected
    - Prerequisites: tasks 4.1, 8.1
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 6.2, 6.3, 10.3_

- [x] 9. Request handler
  - [x] 9.1 Implement `src/web/handler.ts`
    - Export `createRequestHandler(options)` returning `(req, res) => void`, mountable on any `node:http` server. Match `new URL(req.url, "http://x").pathname` against a fixed table of `/`, `/episode.json`, `/episode.mp3`, `/healthz`. Never build a file path from the URL. Ignore the query string
    - Add `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` to every response. Methods other than `GET` and `HEAD` on a known route get 405. Unknown paths get 404
    - Per request: `randomUUID()` request id, duration from `options.now`, and on `res` `finish` one `logger.info("request", { route, method, status, durationMs, bytesSent, requestId, rangeStart?, rangeEnd? })`, with `route` one of the fixed routes or `other`. Log no headers, cookies or query string. Log loader errors with `kind` and field name only
    - Wrap each route in `try/catch`: an unexpected throw becomes 500 `{"error":"internal-error"}`, is logged, and the handler returns so the server keeps serving
    - Prerequisites: tasks 8.2, 8.3, 8.4
    - _Requirements: 7.1, 7.2, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 10.1, 10.2, 10.3, 10.5, 10.6, 11.7_

- [x] 10. Server entry point and start script
  - [x] 10.1 Implement `src/web/server.ts` and the `start` script
    - Export `startServer(options?)` that reads `PORT` (default `WEB_DEFAULT_PORT`), `HOST` (default `WEB_DEFAULT_HOST`) and `BRIEFING_DATA_DIR`, creates `http.createServer(createRequestHandler(...))`, sets `headersTimeout` and `timeout` from `WEB_CONFIG`, and listens
    - An invalid `PORT` (not an integer from 1 to 65535) logs the variable name only, never the value, and exits with a non-zero code. No credentials are required to start. A missing Data_Dir does not stop startup
    - Log one startup line with port, host and Data_Dir, and one line stating whether `loadEpisode(dataDir).ok` is true
    - Handle `SIGTERM` and `SIGINT` by calling `server.close()` then exiting with code 0. Run `startServer()` only when the file is the process entry point, so tests can import it
    - Add `"start": "tsx src/web/server.ts"` to `package.json` scripts. Change nothing else in `package.json` and add no dependency
    - Prerequisite: task 9.1
    - _Requirements: 3.6, 8.8, 9.2, 9.3, 9.4, 9.5, 9.6, 10.4, 11.4, 13.1, 13.2, 13.5_

- [x] 11. Route-level and boundary tests
  - [x] 11.1 Write handler example tests and the server test helper
    - Create `test/helpers/web-server.ts`: starts the handler on `127.0.0.1` with port 0 against a temporary Data_Dir built with the `test/helpers/mp3.ts` builder, returns the base URL and a close function. Confirm `test/helpers/no-network.ts` allows loopback; if it blocks it, extend it to allow `127.0.0.1` only and keep every other outbound call blocked
    - Create `src/web/handler.test.ts` covering: `GET /` with a published episode (200, HTML, audio element) and with none (200, Empty_State_Message, no audio); corrupt `episode.json` and missing MP3 serve the empty page; `HEAD /` header parity; `GET /episode.json` 200 with `Cache-Control` and `ETag`, 304 on matching `If-None-Match`, 404 with `error` code; unknown path 404; `POST /` 405 with `Allow: GET, HEAD`; `GET /healthz` 200 with and without an episode; `nosniff` and `no-referrer` headers on every response; a query string does not change routing; a new episode written to the Data_Dir is served on the next request without restart; a throwing route yields 500 and a later request still succeeds; each request writes one log line with the fields from Requirement 10.2 and no headers
    - Prerequisites: tasks 9.1, 10.1
    - _Requirements: 1.1, 1.7, 3.1, 3.4, 3.5, 3.7, 4.1, 4.2, 4.3, 4.4, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 10.1, 10.2, 10.5, 14.2, 14.3_
  - [x] 11.2 Write MP3 route example tests
    - Create `src/web/episode-mp3.test.ts` using the helper from 11.1: `GET` 200 with `Content-Length`, `Accept-Ranges: bytes`, `audio/mpeg`; 206 closed range with correct `Content-Range`, `Content-Length` and exact bytes; open-ended and suffix ranges; suffix longer than the file returns the whole file; end beyond the file is clamped; 416 with `Content-Range: bytes */<size>` for a start at or beyond the size, a syntactically invalid range, and a multi-range request; `Range: items=0-1` is served as a full 200; `HEAD` header parity; 304 on matching `If-None-Match`; 404 with no episode; a client that aborts mid-stream does not stop a following request; the response log line carries `rangeStart` and `rangeEnd` for a 206
    - Prerequisite: task 11.1
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10, 5.11, 5.12, 10.3, 12.8, 14.2_
  - [x] 11.3 Write the Data_Dir unchanged test
    - Create `src/web/read-only.test.ts`: record the name, size, mtime and content hash of every file in a temporary Data_Dir, send a batch of requests (`GET /`, `GET /episode.json`, `GET /episode.mp3`, a 206 range request, `HEAD /`, a 404 and a 405), and assert the file set and every recorded value are unchanged
    - Prerequisite: task 11.1
    - _Requirements: 6.4, 14.6_
  - [x] 11.4 Write the import-boundary test
    - Create `test/web-import-boundary.test.ts`: statically scan every `.ts` file under `src/web/` (including routes and tests) for `import`/`export ... from` specifiers. Fail on any specifier resolving into `src/ingest/`, `src/summarize/`, `src/tts/`, `src/select/`, `src/ground/`, `src/length/` or `src/pipeline/`, and on any import from `src/publish/` other than `episode-json` and the `EPISODE_MP3_FILE`/`EPISODE_JSON_FILE` constants (no `publish.ts` write functions, no `assemble`)
    - Also assert that no module under those forbidden directories and no module in `src/publish/` imports from `src/web/`, and that `package.json` `dependencies` is unchanged (`@openrouter/sdk` and `rss-parser` only)
    - Prerequisite: task 10.1
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 14.4_

- [x] 12. Checkpoint - Web service tests
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 13. README
  - [x] 13.1 Add the Web_Player section to `README.md`
    - How to start: `npm install` then `npm start`. Environment variables `PORT` (default 8787), `HOST` (default `0.0.0.0`) and `BRIEFING_DATA_DIR` (default `./data`). The routes served: `/`, `/episode.json`, `/episode.mp3`, `/healthz`. State that the Web_Service only serves what the Pipeline already published, never writes the Data_Dir, and needs no credentials
    - State that the one production build is run manually with `TTS_ENGINE=seed` (`npm run build-briefing`), and that the published `episode.mp3` and `episode.json` in `data/` must be present on the host for the page to show the episode, otherwise the page shows the empty-state message
    - Describe exposing the service at a public URL for the demo: the host must forward the port (default 8787, or `PORT`) and the service must bind `0.0.0.0`
    - Keep the "Agent hooks" section from task 1.5 intact. Do not open or quote `.env`
    - Prerequisites: tasks 10.1, 12
    - _Requirements: 13.3, 13.4, 13.5, 13.6_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional. Only the manual hook check (1.6) is optional; every test task is required.
- Exactly six property-based tests exist (Properties 1 to 6 in tasks 4.2, 4.3, 4.4, 4.5, 6.2, 6.3). Everything else is covered by example tests.
- Workspace hooks come first so the guard and the TypeScript reminders apply to the rest of the plan. Hook files use the v1 JSON schema in `.kiro/hooks/<id>.json`; legacy `*.kiro.hook` files are not used. Reload or start a new Kiro session after creating hooks so they load.
- The sensitive-read hook reduces the chance that `.env` or key files enter the agent context. It does not replace keeping secrets out of the repository, and it can be disabled or bypassed by tools that do not go through Kiro's tool calls.
- Hook behavior for `PreToolUse` (exit code 2 plus a stderr message blocks the call) was taken from current Kiro hook documentation and a published capture of the IDE payload. Payload field names are `tool_name` and `tool_input`. The guard scans every string in the payload, so a field-name difference does not disable it.
- `.env` exists in the repo root. No task reads, prints or copies it.
- The Transcript is built from story `title` and `script` only, as decided in design.md.
- Requirement numbers refer to the approved `requirements.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6"] },
    { "id": 3, "tasks": ["2"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2", "4.1", "5.1", "6.1"] },
    { "id": 6, "tasks": ["4.2", "5.2", "6.2", "6.4"] },
    { "id": 7, "tasks": ["4.3", "6.3"] },
    { "id": 8, "tasks": ["4.4"] },
    { "id": 9, "tasks": ["4.5"] },
    { "id": 10, "tasks": ["7"] },
    { "id": 11, "tasks": ["8.1"] },
    { "id": 12, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 13, "tasks": ["9.1"] },
    { "id": 14, "tasks": ["10.1", "11.4"] },
    { "id": 15, "tasks": ["11.1"] },
    { "id": 16, "tasks": ["11.2", "11.3"] },
    { "id": 17, "tasks": ["12"] },
    { "id": 18, "tasks": ["13.1"] },
    { "id": 19, "tasks": ["14"] }
  ]
}
```
