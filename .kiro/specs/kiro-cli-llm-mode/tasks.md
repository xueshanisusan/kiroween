# Implementation Plan: kiro-cli-llm-mode

## Overview

Implementation language is TypeScript (ESM, Node 22, Vitest, fast-check), as used in design.md. The plan extends the existing `ProcessRunner` (`src/tts/tts.ts`) to capture stdout, builds the pure `Output_Cleaner`, builds the Kiro CLI adapter on top of the extended runner, builds the `Llm_Selector`, wires `scripts/build-briefing.ts` to the selector, and updates documentation. The HTTP adapter (`src/summarize/llm.ts`) is not modified except for the additive `LlmError` kinds.

Rules that apply to every task:
- NEVER read, print, grep, list the contents of, or copy `.env`. Use `.env.example` if a variable name is needed. The sensitive-read hook from the web-player spec already blocks this; this plan does not re-create it.
- No new runtime dependency. Only `node:child_process` (via the existing `ProcessRunner`) and `node:timers`/`AbortController` (already global in Node 22) are used.
- Named exports only, no default exports, no `any`, `Result<T, E>` at boundaries, named constants with unit comments in `src/config/`.
- No test spawns a real `kiro-cli` process. Every adapter test injects a fake `ProcessRunner`.
- Exactly six property-based tests exist (Properties 1 to 6, design.md), covering `cleanKiroCliOutput` (Properties 1-5) and `selectLlmAdapter` (Property 6). Every other requirement is covered by example/unit tests. All test tasks are required, following the project convention — none are marked optional.
- `src/web/**` must never import `src/summarize/kiro-cli-adapter.ts` or `src/summarize/select-llm.ts`; the existing web-player import-boundary test is extended to check this rather than duplicated.

## Tasks

- [x] 1. Extend the shared process runner to capture stdout
  - [x] 1.1 Add optional stdout capture to `src/tts/tts.ts`
    - Add `stdout?: string` to the `{ kind: "exited" }` member of `ProcessOutcome`, and `captureStdout?: boolean` plus `captureLimitBytes?: number` to `ProcessSpec`, exactly as in design.md "Process runner reuse"
    - In `createSpawnRunner`'s `run`, when `spec.captureStdout` is true, spawn with `stdio: ["pipe", "pipe", "pipe"]` instead of `["pipe", "ignore", "pipe"]` for that call only, and accumulate a `stdout` buffer capped at `spec.captureLimitBytes` (default: the existing stderr cap, 2000 characters), mirroring the existing `stderr` accumulation exactly. When `captureStdout` is falsy, behavior and spawn options are byte-for-byte unchanged from today
    - Include `stdout` on the `"exited"` outcome only when it was captured; omit the field otherwise
    - _Requirements: 6.1, 6.4, 6.5, 7.4_
  - [x] 1.2 Write unit tests for the stdout capture extension
    - Extend or add to the existing TTS process-runner tests: a call with `captureStdout: true` against a fake spawn function that writes to `stdout` returns the written text on the outcome, capped at `captureLimitBytes`; a call with `captureStdout` unset or `false` behaves exactly as before (no `stdout` field, same `stdio` option passed to the fake spawn function); existing Piper/Seed adapter tests still pass unmodified
    - _Requirements: 6.1, 6.4, 6.5_

- [x] 2. Config constants for the Kiro CLI adapter
  - [x] 2.1 Add named constants to `src/config/index.ts`
    - Add `KIRO_CLI_BINARY` (`"kiro-cli"`), `KIRO_CLI_TIMEOUT_MS` (120000, milliseconds), `KIRO_CLI_STDOUT_LIMIT_BYTES` (200000, bytes), `KIRO_CLI_STDERR_EXCERPT_CHARS` (300, characters) and `KIRO_CLI_NOT_LOGGED_IN_HINTS` (readonly string array, lower-case substrings), each with a unit comment, exactly as in design.md Data Models. Mark the hints constant's comment as UNVERIFIED per design.md
    - Add `LLM_MODE` (`'http' | 'kiro-cli'`, read from `process.env.LLM_MODE`, default `'http'`), with a comment documenting both allowed values, mirroring `TTS_ENGINE`'s existing comment style
    - _Requirements: 2.1, 2.2, 4.1, 5.7, 7.1, 7.2, 7.3_
  - [x] 2.2 Write a config example test for the new constants
    - Add to `src/config/web-config.test.ts` or a new `src/config/kiro-cli.test.ts`: `KIRO_CLI_BINARY` is a non-empty string, `KIRO_CLI_TIMEOUT_MS`/`KIRO_CLI_STDOUT_LIMIT_BYTES`/`KIRO_CLI_STDERR_EXCERPT_CHARS` are positive integers, `KIRO_CLI_NOT_LOGGED_IN_HINTS` is a non-empty array of lower-case strings, and `LLM_MODE` defaults to `'http'` when the environment variable is unset
    - Prerequisite: task 2.1
    - _Requirements: 2.1, 2.2, 7.1, 7.2, 7.3_

- [x] 3. Output_Cleaner
  - [x] 3.1 Implement `src/summarize/clean-kiro-cli-output.ts`
    - Export `cleanKiroCliOutput(raw: string): string` implementing the six-step pipeline from design.md: normalize line endings; strip ANSI CSI and OSC escape sequences; drop leading preamble/tool-use/prompt-echo lines; drop embedded tool-use/tool-result line blocks wherever they occur; strip a single leading reply marker; join and trim
    - Pure function: no I/O, no clock, no randomness. Named export only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 3.2 Write property test for ANSI/carriage-return removal (Property 1)
    - **Property 1: Output_Cleaner removes all ANSI sequences and carriage returns**
    - `// Feature: kiro-cli-llm-mode, Property 1: Output_Cleaner removes all ANSI sequences and carriage returns`
    - Create `src/summarize/clean-kiro-cli-output.property.test.ts`. Generate arbitrary strings interleaved with random ANSI CSI/OSC sequences and `\r`/`\r\n` line endings. Assert the result contains no ANSI escape sequence and no `\r`
    - Prerequisite: task 3.1
    - **Validates: Requirements 3.2, 3.6, 3.7**
  - [x] 3.3 Write property test for idempotence (Property 2)
    - **Property 2: Output_Cleaner is idempotent**
    - `// Feature: kiro-cli-llm-mode, Property 2: Output_Cleaner is idempotent`
    - Add to `src/summarize/clean-kiro-cli-output.property.test.ts`. Generate arbitrary strings, including already-clean ones. Assert `cleanKiroCliOutput(cleanKiroCliOutput(s)) === cleanKiroCliOutput(s)`
    - Prerequisite: task 3.2
    - **Validates: Requirements 3.8**
  - [x] 3.4 Write property test for the identity case (Property 3)
    - **Property 3: Output_Cleaner is the identity on plain reply text**
    - `// Feature: kiro-cli-llm-mode, Property 3: Output_Cleaner is the identity on plain reply text`
    - Add to `src/summarize/clean-kiro-cli-output.property.test.ts`. Generate plain multi-line text from an alphabet excluding `\u001b`, the reply marker and tool-line prefixes. Assert the result equals the input with line endings normalized to `\n` and trimmed
    - Prerequisite: task 3.3
    - **Validates: Requirements 3.9**
  - [x] 3.5 Write property test for metamorphic noise stability (Property 4)
    - **Property 4: Output_Cleaner is metamorphically stable under added noise**
    - `// Feature: kiro-cli-llm-mode, Property 4: Output_Cleaner is metamorphically stable under added noise`
    - Add to `src/summarize/clean-kiro-cli-output.property.test.ts`. Generate a Property-3-style plain text `t`, then wrap/interleave it with random preamble blocks, ANSI codes and tool-use line blocks. Assert `cleanKiroCliOutput(noisy) === cleanKiroCliOutput(t)`
    - Prerequisite: task 3.4
    - **Validates: Requirements 3.10**
  - [x] 3.6 Write property test for all-removable collapse (Property 5)
    - **Property 5: Output_Cleaner collapses all-removable input to empty**
    - `// Feature: kiro-cli-llm-mode, Property 5: Output_Cleaner collapses all-removable input to empty`
    - Add to `src/summarize/clean-kiro-cli-output.property.test.ts`. Generate strings built only from ANSI codes, preamble lines, tool-use lines and the reply marker, in random order and repetition; include the empty string as an explicit `fc.examples` case. Assert the result is `""`
    - Prerequisite: task 3.5
    - **Validates: Requirements 3.11**

- [x] 4. Checkpoint - Output_Cleaner complete
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 5. Extend LlmError and implement the Kiro CLI adapter
  - [x] 5.1 Extend `LlmError` in `src/summarize/llm.ts`
    - Add the `binary-not-found`, `not-logged-in`, `non-zero-exit` (carrying `exitCode: number`), `timeout` and `empty-output` members to the `LlmError` union, additive only, per design.md Data Models
    - Confirm `summarize.ts`'s existing `res.error.kind === "aborted"` check and every other existing caller still compiles unchanged, since the union only grows
    - _Requirements: 5.1, 10.3_
  - [x] 5.2 Implement `src/summarize/kiro-cli-adapter.ts`
    - Export `createKiroCliAdapter(options?: KiroCliAdapterOptions): LlmAdapter` per design.md Components: builds `args = ["chat", "--no-interactive", req.prompt]`, calls `runner.run({ command: binary, args, captureStdout: true, captureLimitBytes: stdoutLimitBytes }, combinedSignal)` with no shell, with neither `--trust-all-tools` nor `--trust-tools`
    - Combine `req.signal` with an internal timeout `AbortController` (`KIRO_CLI_TIMEOUT_MS` default); distinguish which one fired to return `aborted` vs. `timeout`; always clear the timer and remove listeners before returning, and never leave a child process running after `complete` resolves
    - Map `ProcessOutcome` to `Result<string, LlmError>` exactly per design.md's call-sequence diagram: `spawn-failed` with an ENOENT-shaped message → `binary-not-found`; non-zero exit with stderr matching `KIRO_CLI_NOT_LOGGED_IN_HINTS` (case-insensitive substring) → `not-logged-in`; non-zero exit otherwise → `non-zero-exit` with `exitCode` and a message including the code; exit 0 with `cleanKiroCliOutput(stdout)` empty → `empty-output`; exit 0 with non-empty cleaned output → `{ ok: true, value }`
    - Every error message is built from the error kind, the exit code when one exists, and at most `KIRO_CLI_STDERR_EXCERPT_CHARS` characters of stderr — never the prompt, full stderr or stdout. Never retry
    - Log at most one line per call (`event: "kiro-cli-complete"`, `exitStatus`, `durationMs`, `errorKind?`) through an injected logger defaulting to a no-op; never log the prompt, stdout or cleaned reply
    - Never throw for any runtime outcome of the subprocess
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.3, 8.3, 8.4, 8.5, 8.6_
  - [x] 5.3 Write unit tests for the Kiro CLI adapter
    - Create `src/summarize/kiro-cli-adapter.test.ts` with a fake `ProcessRunner` (no real `kiro-cli` spawned): successful run with ANSI/tool-use noise around the reply is cleaned before being returned; non-zero exit with not-logged-in-shaped stderr → `not-logged-in`; non-zero exit with unrelated stderr → `non-zero-exit` carrying the exit code; `spawn-failed` with an ENOENT-shaped message → `binary-not-found`; exit 0 with only-removable stdout → `empty-output`; a runner that never resolves combined with a short injected `timeoutMs` → `timeout`, and the fake runner records that the child was asked to stop; `req.signal` pre-aborted → `aborted` with the runner not invoked, or invoked and immediately cancelled
    - Assert the built `args` array is exactly `["chat", "--no-interactive", prompt]` with no `--trust-*` flag present, and that `captureStdout: true` was requested
    - Assert the fake logger's captured calls never contain the prompt or the stdout text (string-search assertion), and contain at most one call per `complete`
    - Prerequisite: task 5.2
    - _Requirements: 1.2, 1.4, 1.5, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2, 8.4, 8.5, 8.6_

- [x] 6. Checkpoint - Kiro CLI adapter complete
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 7. Llm_Selector
  - [x] 7.1 Implement `src/summarize/select-llm.ts`
    - Export `selectLlmAdapter(mode, factories?): Result<LlmAdapter, LlmError>` per design.md: normalize `mode` the same way `selectTtsAdapter` normalizes `engine` (trim, lower-case, empty/undefined → `'http'`); `'http'` uses `factories.http` or a default `createEnvLlmAdapter(createHttpClient(), process.env)`; `'kiro-cli'` uses `factories.kiroCli` or a default `createKiroCliAdapter()`; any other value returns `{ ok: false, error: { kind: "not-configured", message: ... } }` naming the unknown value and constructing neither adapter
    - This is the only function that constructs a production `LlmAdapter`; `FakeLlm` is untouched
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.10_
  - [x] 7.2 Write property test for the selector's total case-split (Property 6)
    - **Property 6: The selector is total and deterministic over its mode input**
    - `// Feature: kiro-cli-llm-mode, Property 6: The selector is total and deterministic over its mode input`
    - Create `src/summarize/select-llm.property.test.ts`. Generate arbitrary strings plus explicit `undefined`, `''`, `'http'`, `'kiro-cli'`, `'KIRO-CLI'` and `' kiro-cli '` cases. Using fake `http`/`kiroCli` factories returning distinguishable sentinel adapters, assert the three-way branch described in design.md Property 6, and that calling `selectLlmAdapter` twice with the same `mode` returns the same branch both times
    - Prerequisite: task 7.1
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6**
  - [x] 7.3 Write unit tests for the selector
    - Create `src/summarize/select-llm.test.ts`: `'http'`, `''` and `undefined` all return the adapter from the injected `http` factory, verified by reference equality to a sentinel, and the default `http` path (no factory injected) constructs `createEnvLlmAdapter` without throwing; `'kiro-cli'` returns the adapter from the injected `kiroCli` factory; an unknown string returns `{ ok: false }` with `not-configured` and neither factory was called (call-count assertion on both fakes)
    - Prerequisite: task 7.1
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.10_

- [x] 8. Wire the build script to the selector
  - [x] 8.1 Update `scripts/build-briefing.ts`
    - Replace the direct `createEnvLlmAdapter(http, process.env)` call with `selectLlmAdapter(process.env.LLM_MODE, { http: () => createEnvLlmAdapter(http, process.env) })`, called before `mkdirSync`/`runPipeline`, mirroring the existing `selectTtsAdapter` error-handling shape in the same file: on `{ ok: false }`, write the error message to stderr and return 1 without running `runPipeline`
    - Update the file's header comment listing environment variables to add `LLM_MODE`
    - _Requirements: 2.8, 2.9, 8.7_
  - [x] 8.2 Write a test for the build script's LLM mode wiring
    - Add a test (extending the existing pipeline test style, or a new test that imports the script's composition logic through a testable seam) asserting: with `LLM_MODE` unset, the HTTP adapter is used and `runPipeline` behaves exactly as before this feature; with an unknown `LLM_MODE` value, the script exits 1 and `runPipeline` is never called; with `LLM_MODE=kiro-cli`, the Kiro CLI adapter (not the HTTP adapter) is passed to `runPipeline`, using a fake `ProcessRunner` so no real `kiro-cli` is spawned
    - Prerequisite: task 8.1
    - _Requirements: 2.8, 2.9, 10.1, 10.2, 10.3_

- [x] 9. Checkpoint - Selector and build script wired
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 10. Boundary test and documentation
  - [x] 10.1 Extend the import-boundary test
    - Extend the existing `test/web-import-boundary.test.ts` (from the web-player spec) to also fail if any `src/web/**/*.ts` import specifier resolves to `src/summarize/kiro-cli-adapter.ts` or `src/summarize/select-llm.ts`
    - _Requirements: 8.1, 8.2_
  - [x] 10.2 Update `README.md`
    - Add a short description of `LLM_MODE`, its two values (`http` default, `kiro-cli`), and state that `kiro-cli` needs Kiro CLI installed and logged in, spends Kiro credits, and runs only in the batch job (`scripts/build-briefing.ts`); no LLM call happens at request time
    - Do not open or read `.env` while writing this section
    - Prerequisite: task 8.1
    - _Requirements: 9.1, 9.2, 9.6_
  - [x] 10.3 Update `.env.example`
    - Add `LLM_MODE=` with a comment stating the two allowed values and the default, no secret value. Do not add `KIRO_API_KEY` or any Kiro CLI credential, since the adapter relies on the CLI's own login and reads no credential from the environment
    - _Requirements: 9.3, 8.6_
  - [x] 10.4 Update `.kiro/steering/tech.md`
    - State that the Kiro CLI adapter is a local subprocess call, not a network call from project code, and is therefore the one LLM call that does not go through `src/lib/http.ts`, with the reason given
    - State that the Kiro CLI adapter adds no runtime dependency
    - Do not open or read `.env` while making this change
    - _Requirements: 9.4, 9.5, 9.6_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (every property test sub-task: 3.2-3.6, 7.2). Every other test task is required, following this project's existing convention of treating tests as required work.
- Exactly six property-based tests exist (Properties 1 to 6, design.md), implemented in tasks 3.2-3.6 and 7.2. Everything else is covered by unit/example tests.
- Requirement numbers refer to the approved `requirements.md`.
- The "not logged in" stderr detection (`KIRO_CLI_NOT_LOGGED_IN_HINTS`) is explicitly best-effort and UNVERIFIED against a real `kiro-cli` binary — see design.md "Open items resolved by running `kiro-cli chat --help`". Tightening it against a real unauthenticated run is a manual follow-up outside this task list's scope, since it requires a human to run a real CLI session and is not a coding task.
- No task in this plan modifies `src/summarize/llm.ts`'s existing `createEnvLlmAdapter` or `FakeLlm` behavior; task 5.1 only adds new `LlmError` members.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["3.5"] },
    { "id": 6, "tasks": ["3.6"] },
    { "id": 7, "tasks": ["4"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["5.3"] },
    { "id": 11, "tasks": ["6"] },
    { "id": 12, "tasks": ["7.1"] },
    { "id": 13, "tasks": ["7.2", "7.3"] },
    { "id": 14, "tasks": ["8.1"] },
    { "id": 15, "tasks": ["8.2"] },
    { "id": 16, "tasks": ["9"] },
    { "id": 17, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 18, "tasks": ["11"] }
  ]
}
```
