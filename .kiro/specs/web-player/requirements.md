# Requirements Document

## Introduction

The Web_Player is the primary delivery surface of the campus audio briefing. One Node 22 ESM TypeScript service, built on `node:http` with no framework, serves a plain HTML page that plays the published daily briefing MP3 with a native audio control. The same service serves the Episode_JSON and the MP3 file. The Web_Player only reads files that the briefing-pipeline spec already published to the Data_Dir (`episode.mp3` and `episode.json`). It never writes Episode files, never calls TTS or an LLM, and never triggers a build. The production build runs once, manually, for the showcase.

The page has no visual design yet. It uses semantic HTML, the native `<audio controls>` element and near-zero CSS, so a design can be dropped in later. This spec does not define colors, fonts, layout or branding. The phone webhook is a separate spec and is out of scope here.

## Glossary

- **Web_Service**: The single Node 22 ESM TypeScript process that listens on HTTP and hosts the Web_Player routes.
- **Web_Player**: The HTML page served at `/` by the Web_Service, containing the audio control, the Transcript and the Episode_Facts.
- **Data_Dir**: The directory holding published Episode files, set by `BRIEFING_DATA_DIR` (default `./data`), the same value the Pipeline uses.
- **Episode_MP3**: The file `episode.mp3` in the Data_Dir.
- **Episode_JSON**: The file `episode.json` in the Data_Dir, with fields `generatedFor`, `selectedItemIds` and `stories` (each story has `guid`, `title`, `script`), as defined by the briefing-pipeline spec.
- **Published_Episode**: A pair of Episode_MP3 and Episode_JSON where the Episode_JSON parses successfully with the existing `parseEpisode` function and the Episode_MP3 exists and is non-empty.
- **Episode_Loader**: The Web_Service component that reads the Data_Dir and returns a Published_Episode or a typed error as a `Result`.
- **Pipeline**: The batch job `scripts/build-briefing.ts` from the briefing-pipeline spec. The Web_Service never invokes the Pipeline.
- **Transcript**: The text of the briefing shown on the Web_Player, made of each story's `title` and `script` from the Episode_JSON, in order.
- **Episode_Facts**: The text on the Web_Player stating the outlet name and the date of the briefing. The outlet name comes from `src/config/`. The date is the `generatedFor` field.
- **Empty_State_Message**: The plain text shown on the Web_Player when no Published_Episode exists.
- **Range_Request**: An HTTP request carrying a `Range` header with a single `bytes=` range.
- **Request_Log_Line**: One structured JSON log line written per HTTP request, carrying `route`, `status`, `durationMs` and `requestId`.
- **Web_Config**: Named constants and environment settings for the Web_Service in `src/config/` (port, host, Data_Dir, outlet name, cache lifetime, request timeouts).

## Requirements

### Requirement 1: Serve the player page

**User Story:** As a student walking between classes, I want to open one page and press play, so that I hear today's briefing without scrolling or reading.

#### Acceptance Criteria

1. WHEN a client sends `GET /` and a Published_Episode exists, THE Web_Service SHALL respond with status 200, content type `text/html; charset=utf-8` and the Web_Player page.
2. THE Web_Player SHALL contain one native `<audio>` element with the `controls` attribute and a `src` that points to the Episode_MP3 route.
3. THE Web_Player SHALL set the `preload` attribute of the `<audio>` element to `metadata`.
4. THE Web_Player SHALL render without any client-side JavaScript being required to play the briefing.
5. THE Web_Player SHALL use no external resources (no third-party scripts, fonts, images, stylesheets or analytics), so that every byte comes from the Web_Service.
6. THE Web_Player SHALL use at most one inline stylesheet or one stylesheet file, and the stylesheet SHALL contain no color, font family or layout declarations.
7. WHEN a client sends `HEAD /`, THE Web_Service SHALL respond with the same status and headers as `GET /` and no body.

### Requirement 2: Audio alone is sufficient, and the page is accessible

**User Story:** As a screen-reader user, I want the page to be a linear, labelled document, so that I can play the briefing and read the same content as text.

#### Acceptance Criteria

1. THE Web_Player SHALL declare `lang="en"` on the `<html>` element and SHALL contain a non-empty `<title>` element.
2. THE Web_Player SHALL contain exactly one `<h1>` element, and the heading levels below it SHALL not skip a level.
3. THE Web_Player SHALL place the audio control before the Transcript in document order, and SHALL place both inside a `<main>` element.
4. THE Web_Player SHALL give the `<audio>` element an accessible name through an `aria-label` attribute or an associated visible label.
5. THE Web_Player SHALL present the Episode_Facts as text, containing the outlet name and the `generatedFor` date.
6. THE Web_Player SHALL present the Transcript as text, with one heading per story containing the story `title`, followed by that story's `script`.
7. THE Web_Player SHALL escape every Episode_JSON value (`title`, `script`, `generatedFor`) for HTML text context before inserting the value into the page.
8. THE Web_Player SHALL contain no information that is available only through color, images, icons or visual position.
9. THE Web_Player SHALL be operable with the keyboard alone, using only native focusable elements and no `tabindex` value greater than 0.
10. THE Web_Player SHALL include inside the `<audio>` element a fallback text containing a link to the Episode_MP3 route, for clients that cannot render the audio element.

### Requirement 3: Handle no published episode

**User Story:** As a visitor, I want a clear message when there is no briefing yet, so that I know the page works and what to expect.

#### Acceptance Criteria

1. IF no Published_Episode exists, THEN WHEN a client sends `GET /`, THE Web_Service SHALL respond with status 200 and a page containing the Empty_State_Message as visible text.
2. IF no Published_Episode exists, THEN THE Web_Player SHALL omit the `<audio>` element from the page.
3. THE Empty_State_Message SHALL state in plain English that no briefing has been published yet, and SHALL be defined in `src/config/`.
4. IF the Episode_JSON exists but fails `parseEpisode`, THEN THE Episode_Loader SHALL return a typed error naming the invalid field, and THE Web_Service SHALL serve the Empty_State_Message page.
5. IF the Episode_JSON exists and parses but the Episode_MP3 is missing or empty, THEN THE Episode_Loader SHALL return a typed error, and THE Web_Service SHALL serve the Empty_State_Message page.
6. IF the Data_Dir does not exist, THEN THE Web_Service SHALL start successfully, and THE Web_Player SHALL serve the Empty_State_Message page.
7. WHEN the Pipeline publishes a Published_Episode while the Web_Service is running, THE Web_Service SHALL serve that episode on the next request without a restart.

### Requirement 4: Serve the Episode_JSON

**User Story:** As a client developer, I want the Episode_JSON at a stable URL, so that other surfaces can read the same published episode.

#### Acceptance Criteria

1. WHEN a client sends `GET /episode.json` and a Published_Episode exists, THE Web_Service SHALL respond with status 200, content type `application/json; charset=utf-8` and the unmodified bytes of the Episode_JSON file.
2. IF no Published_Episode exists, THEN WHEN a client sends `GET /episode.json`, THE Web_Service SHALL respond with status 404 and a JSON body containing an `error` field with a stable code.
3. WHEN a client sends `GET /episode.json`, THE Web_Service SHALL include a `Cache-Control` header whose `max-age` is the Web_Config JSON cache lifetime (seconds).
4. WHEN a client sends a `GET` or `HEAD` request for `/episode.json`, THE Web_Service SHALL include a strong `ETag` response header, and WHEN the request carries a matching `If-None-Match` header, THE Web_Service SHALL respond with status 304 and no body.

### Requirement 5: Serve the MP3 with range support

**User Story:** As a student on a phone, I want the audio to start playing quickly and to seek, so that the player is ready in under one second.

#### Acceptance Criteria

1. WHEN a client sends `GET /episode.mp3` without a `Range` header and a Published_Episode exists, THE Web_Service SHALL respond with status 200, content type `audio/mpeg`, a `Content-Length` header equal to the file size in bytes and an `Accept-Ranges: bytes` header.
2. WHEN a client sends a Range_Request for `/episode.mp3` whose range lies within the file, THE Web_Service SHALL respond with status 206, a `Content-Range` header of the form `bytes <start>-<end>/<size>`, a `Content-Length` header equal to the number of bytes returned and exactly the requested bytes.
3. WHEN a Range_Request has an open end (`bytes=<start>-`), THE Web_Service SHALL return the bytes from `<start>` to the last byte of the file.
4. WHEN a Range_Request has a suffix form (`bytes=-<length>`), THE Web_Service SHALL return the last `<length>` bytes of the file, or the whole file when `<length>` exceeds the file size.
5. IF a Range_Request starts at or beyond the file size, or is syntactically invalid, THEN THE Web_Service SHALL respond with status 416 and a `Content-Range: bytes */<size>` header.
6. WHEN a Range_Request has an end beyond the last byte, THE Web_Service SHALL clamp the end to the last byte of the file.
7. WHEN a Range_Request contains more than one range, THE Web_Service SHALL respond with status 416 and a `Content-Range: bytes */<size>` header.
8. WHEN a client sends `HEAD /episode.mp3`, THE Web_Service SHALL respond with the same status and headers as the matching `GET` request and no body.
9. THE Web_Service SHALL stream the MP3 body from disk in chunks and SHALL NOT read the whole file into memory per request.
10. IF no Published_Episode exists, THEN WHEN a client sends `GET /episode.mp3`, THE Web_Service SHALL respond with status 404 and a JSON body containing an `error` field with a stable code.
11. WHEN a client sends a request for `/episode.mp3`, THE Web_Service SHALL include a strong `ETag` response header, and WHEN the request carries a matching `If-None-Match` header, THE Web_Service SHALL respond with status 304 and no body.
12. IF the client closes the connection before the response completes, THEN THE Web_Service SHALL close the file handle and continue serving other requests.

### Requirement 6: Serve a consistent episode

**User Story:** As a listener, I want the transcript and the audio to be from the same episode, so that what I read matches what I hear.

#### Acceptance Criteria

1. WHEN the Web_Service builds a response for `GET /`, THE Episode_Loader SHALL read the Episode_JSON and the Episode_MP3 metadata (existence and size) in the same request.
2. WHEN a range-based response for `/episode.mp3` is started, THE Web_Service SHALL compute `Content-Range` and `Content-Length` from the size of the file handle it streams from.
3. WHEN the Pipeline replaces the Episode_MP3 while a response is streaming, THE Web_Service SHALL complete the response from the file handle opened at the start of that response.
4. THE Web_Service SHALL read the Data_Dir only, and SHALL NOT create, modify, rename or delete any file in the Data_Dir.

### Requirement 7: Request-time cost and latency

**User Story:** As a project owner, I want the web service to be free to run and fast, so that the showcase costs nothing beyond the one manual build.

#### Acceptance Criteria

1. THE Web_Service SHALL make no TTS call, no LLM call and no other outbound network call while handling any request.
2. THE Web_Service SHALL expose no route, header, query parameter or method that starts the Pipeline or any generation.
3. WHEN a client sends `GET /` for a Published_Episode, THE Web_Service SHALL send the first byte of the response within 200 ms on the reference demo host (local disk, episode of 60 to 120 s).
4. THE Web_Player SHALL be ready to play within 1 second of the page response, measured by the audio element reporting `loadedmetadata` on the reference demo host.
5. THE Web_Service SHALL set the response `Content-Length` for the HTML page so that the page is not sent with chunked encoding.

### Requirement 8: Routing and request safety

**User Story:** As an operator, I want the service to expose only the routes it needs, so that serving files from disk cannot leak other files.

#### Acceptance Criteria

1. THE Web_Service SHALL respond only to the routes `/`, `/episode.json`, `/episode.mp3` and `/healthz`, and SHALL map each route to a fixed file name or fixed handler, not to a path built from the request URL.
2. IF a request targets any other path, THEN THE Web_Service SHALL respond with status 404 and a JSON body containing an `error` field with a stable code.
3. IF a request uses a method other than `GET` or `HEAD`, THEN THE Web_Service SHALL respond with status 405 and an `Allow: GET, HEAD` header.
4. WHEN a client sends `GET /healthz`, THE Web_Service SHALL respond with status 200 and a JSON body stating the service is up, whether or not a Published_Episode exists.
5. THE Web_Service SHALL ignore the query string when routing, and SHALL never use any part of the request URL to build a file system path.
6. THE Web_Service SHALL include the response headers `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on every response.
7. IF an unexpected error occurs while handling a request, THEN THE Web_Service SHALL respond with status 500 and a JSON body containing an `error` field with a stable code, and SHALL keep serving later requests.
8. THE Web_Service SHALL set a request header timeout and an overall socket idle timeout from Web_Config, in milliseconds.

### Requirement 9: Configuration

**User Story:** As a maintainer adding a campus, I want every campus-specific and tunable value in config, so that I do not edit modules.

#### Acceptance Criteria

1. THE Web_Config SHALL define the outlet name, the page title, the Empty_State_Message, the audio label text, the JSON cache lifetime (seconds), the header timeout (milliseconds) and the idle timeout (milliseconds) as named constants in `src/config/`, each with a comment stating its unit.
2. THE Web_Service SHALL read the listening port from the `PORT` environment variable, defaulting to a named constant in `src/config/`.
3. THE Web_Service SHALL read the bind host from the `HOST` environment variable, defaulting to `0.0.0.0` so that a container or hosted deployment is reachable.
4. THE Web_Service SHALL read the Data_Dir from `BRIEFING_DATA_DIR`, defaulting to the same `./data` default used by the Pipeline.
5. IF `PORT` is set to a value that is not an integer from 1 to 65535, THEN THE Web_Service SHALL exit with a non-zero code and a log line naming the variable, without printing its value if the value could be a secret.
6. THE Web_Service SHALL require no credentials and no API keys to start.

### Requirement 10: Logging

**User Story:** As an operator, I want one structured log line per request, so that I can see what the demo served.

#### Acceptance Criteria

1. WHEN a request completes, THE Web_Service SHALL write one Request_Log_Line as a single JSON line using the existing `src/lib/log.ts` logger.
2. THE Request_Log_Line SHALL contain `route` (one of the fixed routes or `other`), `method`, `status`, `durationMs`, `bytesSent` and `requestId`.
3. WHEN a response is a range response, THE Request_Log_Line SHALL also contain the served `rangeStart` and `rangeEnd`.
4. WHEN the Web_Service starts, THE Web_Service SHALL write one log line with the port, host and Data_Dir, and one log line stating whether a Published_Episode was found.
5. THE Request_Log_Line SHALL omit request headers, cookies and the query string.
6. WHEN the Episode_Loader returns a typed error, THE Web_Service SHALL write one log line with the error kind and, for an invalid field, the field name.

### Requirement 11: Layering and dependencies

**User Story:** As a maintainer, I want the web layer to depend only on the published files, so that the architecture rules hold and the phone webhook can reuse it later.

#### Acceptance Criteria

1. THE Web_Service SHALL import from the publish layer only the read-side items (`parseEpisode`, the `EpisodeJson` type and the Episode file name constants) and from `src/config/`, `src/lib/` and `src/types.ts`.
2. THE Web_Service SHALL NOT import any module from `src/ingest/`, `src/summarize/`, `src/tts/`, `src/select/`, `src/ground/`, `src/length/` or `src/pipeline/`, and no module in those directories SHALL import the Web_Service.
3. THE Web_Service SHALL NOT import `publish.ts` write functions, so that only the Pipeline writes Episode files.
4. THE Web_Service SHALL use `node:http` and Node built-in modules only, and SHALL add no runtime dependency to `package.json`.
5. THE Episode_Loader and the route handlers SHALL return `Result<T, E>` values for expected failures and SHALL throw only for programmer error.
6. THE Web_Service SHALL use named exports only, no default exports and no `any`.
7. THE Web_Service SHALL expose its request handler as a function that can be mounted on a `node:http` server, so that the later phone webhook spec can add routes to the same server without changing the Web_Player routes.

### Requirement 12: Pure rendering and parsing

**User Story:** As a developer, I want the page renderer and the Range header parser to be pure functions, so that they are testable with property-based tests.

#### Acceptance Criteria

1. THE Page_Renderer SHALL be a pure function from a Published_Episode (or the absence of one) and Web_Config text to an HTML string, with no I/O, no clock and no randomness.
2. THE Range_Parser SHALL be a pure function from a `Range` header value and a file size to either a satisfiable byte range, an unsatisfiable result or a not-a-range result.
3. FOR ALL file sizes greater than 0 and all satisfiable ranges, THE Range_Parser SHALL return a range where `0 <= start <= end < size`.
4. FOR ALL ranges returned by the Range_Parser, the number of bytes in the response SHALL equal `end - start + 1`.
5. FOR ALL Episode_JSON values, THE Page_Renderer SHALL produce HTML in which every story `title` and `script` appears as escaped text, and no raw `<` from an Episode_JSON value appears as markup.
6. FOR ALL Episode_JSON values, THE Page_Renderer SHALL produce a page with exactly one `<h1>`, one `<audio controls>` element and one heading per story.
7. FOR ALL Range headers formatted from a valid range by a range formatter, parsing the formatted header SHALL return the same range (round-trip property).
8. THE Range_Parser SHALL treat a header value that does not start with `bytes=` as not-a-range, and THE Web_Service SHALL then respond as if no `Range` header was sent.

### Requirement 13: Start script, deployment and documentation

**User Story:** As a hackathon judge, I want to start the service with one command and open a working URL, so that I can try the product from a clean checkout.

#### Acceptance Criteria

1. THE package SHALL provide an npm script named `start` that runs the Web_Service on Node 22 without requiring a separate build step beyond what the repository already uses to run `scripts/build-briefing.ts`.
2. THE package SHALL provide a script entry point `src/web/server.ts` (or the equivalent path chosen in the design) that creates the server, starts listening and handles `SIGTERM` and `SIGINT` by closing the server and exiting with code 0.
3. THE README SHALL contain a section stating how to start the Web_Service, the environment variables `PORT`, `HOST` and `BRIEFING_DATA_DIR`, the routes served, and that the Web_Service only serves what the Pipeline already published.
4. THE README SHALL state that the one production build is run manually with `TTS_ENGINE=seed`, and that the published `data/` files must be present on the host for the Web_Player to show the episode.
5. WHEN the repository is cloned, dependencies are installed, and `npm start` is run with a Published_Episode in the Data_Dir, THE Web_Service SHALL serve the Web_Player on the configured port with no other setup and no credentials.
6. THE README SHALL describe how to expose the Web_Service at a public URL for the hackathon demo, naming the port the host must forward.

### Requirement 14: Test coverage

**User Story:** As a maintainer, I want the web layer tested without a network or real audio services, so that a clean checkout can verify it.

#### Acceptance Criteria

1. THE test suite SHALL cover the Range_Parser and the Page_Renderer with Vitest and fast-check property tests of at least 100 runs each, covering the properties in Requirement 12.
2. THE test suite SHALL cover the routes with example tests that start the Web_Service on an ephemeral port against a temporary Data_Dir, including: published episode, no episode, corrupt Episode_JSON, missing MP3, `Range` 206 and 416 cases, `HEAD`, 304, 404, 405 and `/healthz`.
3. THE test suite SHALL use the existing test MP3 builder helper to create the Episode_MP3, and SHALL NOT call any real TTS or LLM service.
4. THE test suite SHALL include an import-boundary test that fails when any module under the web directory imports from the forbidden layers in Requirement 11.2 or imports a publish write function.
5. THE test suite SHALL include a test that a page rendered from an Episode_JSON with a `script` of `<script>alert(1)</script>` contains no executable script element.
6. THE test suite SHALL include a test that a request to the Web_Service leaves every file in the Data_Dir unchanged.
