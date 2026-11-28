# Design Document

## Overview

The Web_Player is a second Node 22 ESM TypeScript entry point, `src/web/server.ts`, built directly on `node:http`. It reads the two files the Pipeline (`scripts/build-briefing.ts`, briefing-pipeline spec) already published to the Data_Dir — `episode.mp3` and `episode.json` — and serves four fixed routes: `/`, `/episode.json`, `/episode.mp3`, `/healthz`. It never writes to the Data_Dir, never runs the Pipeline, and never calls an LLM or TTS service. Every request is a read of whatever is on disk at that moment, so a new Published_Episode becomes visible on the very next request with no restart (Requirement 3.7).

This design follows `docs/brief.md`, `AGENTS.md`, and the steering files in `.kiro/steering/`. Where this design surfaces a tension with a frozen requirement, it is recorded in **Decisions carried over from requirements review** below rather than changing `requirements.md`.

The module reuses the briefing-pipeline's conventions directly: `Result<T, E>` at boundaries (`src/types.ts`), named exports only, no `any`, structured JSON logs through `src/lib/log.ts`, and named constants with unit comments in `src/config/`. It imports `parseEpisode`, `EpisodeJson`, `EPISODE_MP3_FILE` and `EPISODE_JSON_FILE` from `src/publish/` (read-side only) and nothing from `src/ingest/`, `src/summarize/`, `src/tts/`, `src/select/`, `src/ground/`, `src/length/` or `src/pipeline/` (Requirement 11).

### Decisions carried over from requirements review

- **Transcript scope.** The Transcript (Requirement 2.6) is built only from each story's `title` and `script`, in `stories` order. It does not include the Pipeline's intro/outro template text, because that text is not a discrete field on `EpisodeJson` — `episode.json` carries `stories[]`, not the assembled `episode.mp3` script. The audio itself (which does include the spoken intro/outro) is the complete, authoritative version; the on-page Transcript is the per-story text companion to it. This is a deliberate scope decision, not a defect: it keeps the Page_Renderer a pure function of `EpisodeJson` with no second data source.
- **`/healthz` kept as a fifth fixed route.** Requirement 8.1 lists four routes including `/healthz`; Requirement 7.2 forbids any route that starts the Pipeline or generation. `/healthz` reports process liveness only (status 200, fixed JSON body, no Data_Dir read beyond what `GET /` already does for logging) and triggers no generation, so it does not conflict with 7.2.
- **Empty state returns 200, not 404.** Requirement 3.1 fixes this: `GET /` with no Published_Episode is still a successful page load (status 200) containing the Empty_State_Message as visible text. Only `/episode.json` and `/episode.mp3` return 404 in the no-episode case (4.2, 5.10), because those routes name a specific resource that is absent, whereas `/` is a page that always renders successfully, with or without an episode.

## Architecture

```
src/web/server.ts        (entry point: creates node:http server, listens, SIGTERM/SIGINT)
        │
        ▼
src/web/handler.ts        (createRequestHandler: router + cross-cutting headers/logging)
        │
        ├─▶ src/web/episode-loader.ts   (reads Data_Dir → Published_Episode | typed error)
        ├─▶ src/web/render.ts           (pure: Published_Episode|empty + Web_Config → HTML string)
        ├─▶ src/web/range.ts            (pure: Range header + file size → RangeResult)
        └─▶ src/web/routes/*.ts         (one handler per fixed route, built on the two above)
                │
                ▼
        src/publish/episode-json.ts (parseEpisode, EpisodeJson)  [read-side import only]
        src/publish/publish.ts      (EPISODE_MP3_FILE, EPISODE_JSON_FILE constants only)
        src/config/index.ts         (Web_Config constants)
        src/lib/log.ts              (createLogger)
        src/types.ts                (Result<T,E>)
```

Request flow for `GET /`:

```
node:http request
  → handler strips query string, matches path to one of 5 fixed routes
  → route handler calls loadEpisode(dataDir) → Result<Published_Episode, EpisodeLoadError>
  → renderPage(result, webConfig) → html string   (pure; no I/O after loadEpisode returns)
  → handler sets headers (Content-Length, Content-Type, security headers), writes body
  → handler writes one Request_Log_Line with route/status/durationMs/bytesSent/requestId
```

`loadEpisode` is the only place that touches the filesystem for `/`. For `/episode.json` and `/episode.mp3` the route handlers read the file directly (streaming for the MP3) rather than going through `loadEpisode`, because those routes serve raw bytes rather than a rendered page; they still use the same existence/parse checks so that a corrupt or missing file produces the same typed errors (Requirement 6.1 only binds `/`'s loader to reading both JSON and MP3 metadata together — the JSON and MP3 routes each check their own file independently, which satisfies 6.2/6.3 by construction since each route opens its own file handle per request).

The handler is exposed as a plain `(req, res) => void` function (`createRequestHandler`), so `src/web/server.ts` does `http.createServer(createRequestHandler(options))`, and a later phone-webhook spec can wrap or compose the same handler on the same `node:http` server without changing these four routes (Requirement 11.7).

## Components and Interfaces

### Episode_Loader (`src/web/episode-loader.ts`)

```ts
export type EpisodeLoadError =
  | { kind: "no-episode" }                                   // json and/or mp3 missing
  | { kind: "invalid-field"; field: string; message: string } // parseEpisode failed
  | { kind: "empty-mp3" };                                    // json ok, mp3 missing/zero bytes

export type PublishedEpisode = {
  episode: EpisodeJson;
  mp3Path: string;
  mp3SizeBytes: number;
};

export function loadEpisode(dataDir: string): Result<PublishedEpisode, EpisodeLoadError>;
```

- Reads `<dataDir>/episode.json` (via `EPISODE_JSON_FILE`) with `readFileSync`; a missing file (`ENOENT`) or a missing/non-existent `dataDir` (Requirement 3.6) gives `{ kind: "no-episode" }`, not a thrown error.
- Parses the JSON text with `parseEpisode` (`src/publish/episode-json.ts`); a parse failure passes its `field`/`message` straight through as `{ kind: "invalid-field", ... }` (Requirement 3.4).
- Statts `<dataDir>/episode.mp3` (via `EPISODE_MP3_FILE`) with `statSync`; missing or `size === 0` gives `{ kind: "empty-mp3" }` (Requirement 3.5).
- Does one `readFileSync` and one `statSync` per call — "read the Episode_JSON and the Episode_MP3 metadata... in the same request" (Requirement 6.1) means one `loadEpisode` call per `GET /`/`HEAD /`, not a cross-request cache.
- Never writes, renames or deletes anything (Requirement 6.4) — the module imports no write primitive from `publish.ts`.

### Page_Renderer (`src/web/render.ts`)

```ts
export type RenderInput =
  | { kind: "published"; episode: EpisodeJson }
  | { kind: "empty" };

export type PageText = {
  outletName: string;
  pageTitle: string;
  emptyStateMessage: string;
  audioLabel: string;
};

export function renderPage(input: RenderInput, text: PageText): string;
export function escapeHtml(value: string): string;
```

- Pure: no `fs`, no `Date.now()`, no `Math.random()`, no module-level mutable state. Every value that varies comes through `input`/`text`.
- `escapeHtml` escapes `& < > " '` and is the only path by which an `EpisodeJson` string value reaches the output (Requirement 2.7, 12.5).
- `"published"` branch emits, in document order inside `<main>`: the audio control (`<audio controls preload="metadata" aria-label=... >` wrapping a fallback `<a href="/episode.mp3">...</a>`, Requirement 2.10), then the Episode_Facts text (outlet name + `generatedFor`), then the Transcript as one `<h2>` (story title) + `<p>` (story script) pair per story, in `stories` order.
- `"empty"` branch omits the `<audio>` element entirely (Requirement 3.2) and renders only the Empty_State_Message as visible text inside `<main>`.
- Exactly one `<h1>` always appears (page heading, e.g. the outlet name), with per-story headings at `<h2>` so no level is skipped (Requirement 2.2, 12.6).
- The inline stylesheet (at most one `<style>` block, Requirement 1.6) sets no `color`, `font-family` or layout (`display`, `position`, `width`, etc.) property — only resets that are visual-design-neutral (e.g. `audio { width: 100%; }` is layout and is therefore **excluded**; the stylesheet is limited to non-layout resets such as `box-sizing` or omitted entirely). Given the constraint is easy to violate by accident, the design keeps the stylesheet to zero declarations (an empty `<style>` tag is also disallowed by "at most one", so the simplest compliant choice is to emit no `<style>` element at all in v1).

### Range_Parser (`src/web/range.ts`)

```ts
export type SatisfiableRange = { kind: "satisfiable"; start: number; end: number };
export type UnsatisfiableRange = { kind: "unsatisfiable" };
export type NotARange = { kind: "not-a-range" };
export type RangeResult = SatisfiableRange | UnsatisfiableRange | NotARange;

export function parseRange(headerValue: string | undefined, sizeBytes: number): RangeResult;
/** Test-only / shared helper used by the round-trip property (12.7). */
export function formatRange(range: { start: number; end: number }): string;
```

- `undefined` or a value not starting with `bytes=` → `not-a-range` (Requirement 12.8); the route then serves the full file as if unranged.
- More than one comma-separated range → `unsatisfiable` (Requirement 5.7 — the design treats a multi-range request as unsatisfiable rather than serving only the first range, since multipart/byteranges responses are out of scope).
- Syntactically invalid single range (non-numeric, `start > end` in closed form, empty) → `unsatisfiable` (Requirement 5.5).
- `start >= sizeBytes` → `unsatisfiable` (Requirement 5.5), including `sizeBytes === 0`.
- Open end `bytes=<start>-` → `satisfiable` with `end = sizeBytes - 1` (Requirement 5.3).
- Suffix form `bytes=-<length>` → `satisfiable` with `start = max(0, sizeBytes - length)`, `end = sizeBytes - 1`; `length >= sizeBytes` serves the whole file (Requirement 5.4).
- Closed form with `end >= sizeBytes` → clamp `end = sizeBytes - 1` (Requirement 5.6).
- Every `satisfiable` result obeys `0 <= start <= end < sizeBytes` (Requirement 12.3) by construction of the branches above.

### Route handlers (`src/web/routes/`)

One file per route, each a thin function `(ctx) => RouteResult` composed by `createRequestHandler`:

```ts
export type RouteResult = {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string | Readable | null; // null for HEAD and 304
};
```

- **`root.ts`** (`/`): calls `loadEpisode`, maps the `Result` to a `RenderInput`, calls `renderPage`, sets `Content-Type: text/html; charset=utf-8` and `Content-Length` (Requirement 7.5 — buffering the whole string is acceptable because the page is small text, unlike the MP3). `HEAD /` reuses the same status/headers computation and returns `body: null` (1.7).
- **`episode-json.ts`** (`/episode.json`): on success, reads the raw file bytes (not the parsed/re-serialized object, so "unmodified bytes" per 4.1 holds exactly), sets `Content-Type: application/json; charset=utf-8`, `Cache-Control: max-age=<JSON_CACHE_MAX_AGE_SECONDS>`, and a strong `ETag` computed from the file (sha1 hex of the bytes, quoted). On `If-None-Match` matching the current `ETag`, responds 304 with no body (4.4). On `{ kind: "no-episode" }` from a direct file check (independent of `loadEpisode`'s combined view — see Architecture note), responds 404 with `{ "error": "no-episode" }` (4.2).
- **`episode-mp3.ts`** (`/episode.mp3`): opens the file with `fs.createReadStream`, computing size via `statSync` first. Parses the `Range` header with `parseRange`. `not-a-range` → 200 with full `Content-Length`, `Accept-Ranges: bytes`, streamed body (5.1). `satisfiable` → 206 with `Content-Range: bytes <start>-<end>/<size>`, `Content-Length: end-start+1`, a stream opened with `{ start, end }` (5.2). `unsatisfiable` → 416 with `Content-Range: bytes */<size>`, no body (5.5, 5.7). Sets the same strong `ETag` scheme as the JSON route (hash of file bytes, computed once lazily and reused — see Data Models) and honors `If-None-Match` the same way (5.11). On stream `"close"`/client-abort, destroys the stream and returns without writing further (5.12); the server keeps accepting new requests because each request has its own stream and timeout.
- **`healthz.ts`** (`/healthz`): always 200, fixed JSON body `{ "status": "ok" }`, independent of Published_Episode state (8.4).
- **`not-found.ts` / `method-not-allowed.ts`**: shared handlers for any other path (404, `{ "error": "not-found" }`, 8.2) and any method other than GET/HEAD on a known route (405, `Allow: GET, HEAD`, 8.3).

### Request handler (`src/web/handler.ts`)

```ts
export type HandlerOptions = {
  dataDir: string;
  config: WebConfig;
  logger: Logger;
  now?: () => number; // for duration measurement; defaults to Date.now
};

export function createRequestHandler(options: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => void;
```

- Strips the query string before matching (`new URL(req.url, "http://x").pathname`), and routes on the pathname alone against a fixed table `{ "/": root, "/episode.json": episodeJson, "/episode.mp3": episodeMp3, "/healthz": healthz }` — never on a path built by concatenating the request URL into a filesystem path (Requirement 8.1, 8.5).
- Adds `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` to every response (8.6).
- Generates one `requestId` (`randomUUID()`) per request, measures `durationMs` via `options.now`, and after the response finishes (`res.on("finish", ...)`) calls `logger.info("request", { route, method, status, durationMs, bytesSent, requestId, ...rangeFields })` (Requirement 10.1–10.3, 10.5).
- Wraps every route call in `try/catch`; an uncaught throw becomes a 500 JSON error body and is logged, after which the handler returns normally so the server keeps listening (Requirement 8.7).
- Enforces the header timeout and idle timeout from `WebConfig` on the underlying `http.Server` (`server.headersTimeout`, `server.timeout`), set once in `src/web/server.ts` (Requirement 8.8).

### Entry point (`src/web/server.ts`)

```ts
export function startServer(options?: Partial<HandlerOptions>): http.Server;
```

- Reads `PORT`, `HOST`, `BRIEFING_DATA_DIR` from `process.env` with the defaults in `WebConfig` (Requirement 9.2–9.4); an invalid `PORT` logs the variable name only (never its value) and calls `process.exit(1)` (9.5).
- Builds `createLogger()` from `src/lib/log.ts`, logs one startup line with port/host/dataDir and one line stating whether `loadEpisode(dataDir).ok` is true at startup (Requirement 10.4).
- Registers `SIGTERM`/`SIGINT` handlers that call `server.close()` and then `process.exit(0)` (Requirement 13.2).
- `npm start` (new `package.json` script) runs `tsx src/web/server.ts`, matching the existing `build-briefing` script's pattern; no new runtime dependency is introduced (`node:http`, `node:fs`, `node:crypto`, `node:url` only — Requirement 11.4).

## Data Models

```ts
// src/config/index.ts additions (Web_Config, Requirement 9.1)
export type WebConfig = {
  outletName: string;
  pageTitle: string;
  emptyStateMessage: string;
  audioLabel: string;
  jsonCacheMaxAgeSeconds: number;   // seconds
  headerTimeoutMs: number;         // milliseconds
  idleTimeoutMs: number;           // milliseconds
};

export const WEB_CONFIG: WebConfig = {
  outletName: CAMPUS_NAME,
  pageTitle: `${CAMPUS_NAME} Briefing`,
  emptyStateMessage: "No briefing has been published yet. Check back soon.",
  audioLabel: `Play today's ${CAMPUS_NAME} briefing`,
  jsonCacheMaxAgeSeconds: 60,       // seconds: short, since a new build can publish any time
  headerTimeoutMs: 10_000,          // milliseconds
  idleTimeoutMs: 30_000,            // milliseconds
};

/** Default web server port (number, 1-65535), overridden by PORT. */
export const WEB_DEFAULT_PORT = 8787;
```

```ts
// src/web/episode-loader.ts
export type PublishedEpisode = { episode: EpisodeJson; mp3Path: string; mp3SizeBytes: number };
export type EpisodeLoadError =
  | { kind: "no-episode" }
  | { kind: "invalid-field"; field: string; message: string }
  | { kind: "empty-mp3" };
```

```ts
// src/web/render.ts
export type RenderInput = { kind: "published"; episode: EpisodeJson } | { kind: "empty" };
```

```ts
// src/web/range.ts
export type RangeResult =
  | { kind: "satisfiable"; start: number; end: number }
  | { kind: "unsatisfiable" }
  | { kind: "not-a-range" };
```

`EpisodeJson`, `EpisodeStory` and `EpisodeParseError` are reused unchanged from `src/publish/episode-json.ts` (Requirement 11.1); this design adds no competing shape for episode data.

`ETag` values: computed as `"<sha1-hex-of-file-bytes>"` (quoted, strong). For `/episode.mp3`, the hash is computed once per process from the file at first request and cached by `(path, mtimeMs, size)` key, recomputed only when `mtimeMs`/`size` change, so range requests do not re-hash the file on every request; this is an internal optimization, not a new requirement.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Satisfiable ranges are well-formed and clamped

For any file size `size > 0` and any `Range` header value, if `parseRange(header, size)` returns a `satisfiable` result, then `0 <= start <= end < size`, and if the header's requested end (open, closed, or suffix form) extends at or beyond `size`, the returned `end` equals `size - 1`.

**Validates: Requirements 5.3, 5.4, 5.6, 12.3**

### Property 2: Unsatisfiable and not-a-range classification

For any file size `size > 0`, (a) any header value that does not start with `bytes=` classifies as `not-a-range`; (b) any header containing more than one comma-separated range, any syntactically invalid single range, or any range whose `start >= size` classifies as `unsatisfiable`.

**Validates: Requirements 5.5, 5.7, 12.8**

### Property 3: Range response byte count matches the parsed range

For any `satisfiable` result `{ start, end }` returned by `parseRange`, the number of bytes a route would stream for that range equals `end - start + 1`.

**Validates: Requirements 12.4**

### Property 4: Range header round-trip

For any file size `size > 0` and any `start`, `end` with `0 <= start <= end < size`, formatting `{ start, end }` with `formatRange` and then parsing that formatted string with `parseRange(_, size)` returns `{ kind: "satisfiable", start, end }`.

**Validates: Requirements 12.7**

### Property 5: Rendered output escapes every Episode_JSON value

For any `EpisodeJson` value (including stories whose `title` or `script` contain `<`, `>`, `&`, `"` or a literal `<script>` substring), `renderPage({ kind: "published", episode }, text)` produces a string in which every character of `title` and `script` appears only in escaped form, and no `<` originating from an `EpisodeJson` field value appears as the start of a tag in the output.

**Validates: Requirements 2.7, 12.5**

### Property 6: Rendered output has fixed structural shape

For any `EpisodeJson` value with `n >= 0` stories, `renderPage({ kind: "published", episode }, text)` produces a string containing exactly one `<h1 ...>` element, exactly one `<audio controls ...>` element, and exactly `n` per-story heading elements; `renderPage({ kind: "empty" }, text)` produces a string containing exactly one `<h1 ...>` element and zero `<audio` elements.

**Validates: Requirements 2.2, 3.2, 12.6**

## Error Handling

- Every function at a module boundary that can fail (`loadEpisode`, route handlers reading `episode.json`/`episode.mp3` directly) returns `Result<T, E>` with a discriminated `kind` field; nothing throws except genuine programmer error, per `structure.md`. The handler's top-level `try/catch` (Requirement 8.7) exists only as a last-resort guard against a programmer error surfacing as a 500 rather than crashing the process, not as the normal path for expected failures.
- `loadEpisode` never deletes, renames or quarantines a file it fails to parse (mirrors the briefing-pipeline's rule for `parseEpisode` failures) — a human can inspect the bad `episode.json` after the fact (Requirement 3.4, 6.4).
- A missing Data_Dir is treated identically to a missing `episode.json`: `{ kind: "no-episode" }`, not a crash, so the server can start before the first Pipeline run ever happens (Requirement 3.6).
- An `EpisodeLoadError` is always logged with its `kind` and, for `invalid-field`, the `field` name, on the request that encountered it (Requirement 10.6) — never the full file contents or the parse exception message, which could be large or contain article text.
- A closed client connection during an MP3 stream destroys the readable stream and lets `res` finish or error silently; the per-request file handle means one slow or aborted client cannot affect another request's stream (Requirement 5.12).
- An invalid `PORT` environment variable is a startup-time configuration error: logged by variable name only, then `process.exit(1)` — the value is treated as potentially sensitive and never logged (Requirement 9.5), matching the pipeline's existing redaction convention in `src/lib/log.ts`.

## Testing Strategy

**Property-based tests** (fast-check, minimum `PROPERTY_TEST_RUNS` = 100 runs each, one test per property, tagged `// Feature: web-player, Property N: <title>`):

1. **Property 1** (`src/web/range.test.ts`): generator produces random `size > 0` and random valid range forms (closed, open-ended, suffix) whose semantic end may exceed `size`; asserts the invariant and the clamp.
2. **Property 2** (`src/web/range.test.ts`): generator produces random non-`bytes=` strings, random multi-range strings, random syntactically invalid single ranges, and random `start >= size` ranges; asserts the classification in each case.
3. **Property 3** (`src/web/range.test.ts`): reuses Property 1's generator restricted to the `satisfiable` outputs; asserts `end - start + 1` matches the byte count a `fs.createReadStream(path, { start, end })` would produce for a file of that size (verified against a fixture buffer, not a real Data_Dir file, to stay a pure unit test).
4. **Property 4** (`src/web/range.test.ts`): generator produces random `size`, `start`, `end` triples satisfying `0 <= start <= end < size`; round-trips through `formatRange`/`parseRange`.
5. **Property 5** (`src/web/render.test.ts`): generator produces random `EpisodeJson` values using fast-check string generators biased toward `<`, `>`, `&`, `"`, `'` and literal `<script>…</script>` substrings for `title`/`script`; asserts no unescaped `<` from those fields survives into the output. This subsumes the literal example in Requirement 14.5, which stays as a `fc.examples` regression case in the same test.
6. **Property 6** (`src/web/render.test.ts`): generator produces random `EpisodeJson` values with `0` to `5` stories (varying lengths, including empty-string titles/scripts); asserts the element counts, and separately asserts the `"empty"` branch shape.

**Unit and example tests** cover: `loadEpisode` branches (no dataDir, no json, no mp3, zero-byte mp3, corrupt json field-by-field) using temporary directories and the shared `test/helpers/mp3.ts` builder for the MP3 fixture (Requirement 14.3); route-level behavior for each of the 14.2 scenarios (published episode on `GET /`, empty state on `GET /`, `GET /episode.json` 200/404/304, `GET /episode.mp3` 200/206/404/416/304, `HEAD /` and `HEAD /episode.mp3` header parity, 404 for an unknown path, 405 with `Allow` header for `POST /`, `GET /healthz` regardless of episode state) started against an ephemeral port and a temporary Data_Dir; the literal `<script>alert(1)</script>` example (Requirement 14.5); a test asserting every file under a temporary Data_Dir is byte-for-byte unchanged (mtime and content) after a batch of requests including a 206 range request (Requirement 14.6, 6.4); and an import-boundary test (Requirement 14.4) that statically scans `src/web/**/*.ts` imports and fails if any resolve into `src/ingest/`, `src/summarize/`, `src/tts/`, `src/select/`, `src/ground/`, `src/length/`, `src/pipeline/`, or `src/publish/publish.js`'s write-side exports (`publishEpisode` or equivalent — only `EPISODE_MP3_FILE`/`EPISODE_JSON_FILE` constants are allowed from that module).

No test calls a real TTS or LLM service; `test/helpers/no-network.ts` (already active via `vitest.config.ts`) guarantees any accidental outbound call fails the test (Requirement 14.3).
