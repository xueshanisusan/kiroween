# Design Document

## Overview

This feature adds a second `LlmAdapter` implementation, `Kiro_Cli_Adapter` (`src/summarize/kiro-cli-adapter.ts`), that runs the `kiro-cli` executable as a subprocess instead of calling an HTTP endpoint. An `Llm_Selector` (`src/summarize/select-llm.ts`), analogous to the existing `selectTtsAdapter` (`src/tts/tts.ts`), reads `LLM_MODE` and returns either the existing `Http_Llm_Adapter` (`createEnvLlmAdapter`, `src/summarize/llm.ts`, unchanged) or the new `Kiro_Cli_Adapter`. `scripts/build-briefing.ts` is the only caller of the selector. Nothing at request time (`src/web/`, a future telephony module) ever imports either the selector or the Kiro CLI adapter.

The new adapter reuses the `ProcessRunner`/`ProcessSpec`/`ProcessOutcome` shapes already defined for the Piper TTS adapter (`src/tts/tts.ts`) rather than inventing a parallel subprocess abstraction, because both adapters have the identical requirement: run one child process with no shell, capture stdout/stderr, support a timeout and an `AbortSignal`, and never throw. The Kiro CLI adapter captures stdout (the TTS runner does not, since Piper writes to a file), so this design adds an options bag to the runner call rather than changing its signature, documented below.

### Open items resolved by running `kiro-cli chat --help` and the vendor docs

This machine has no `kiro-cli` on `PATH` (`Get-Command kiro-cli` fails; only `kiro.cmd`, the desktop IDE launcher, is present), so `kiro-cli chat --help` could not be run directly as asked. The findings below come from the vendor's own CLI reference and headless-mode documentation instead (`kiro.dev/docs/reference/cli-commands/`, `kiro.dev/docs/cli/headless/`, `kiro.dev/docs/reference/exit-codes/`), which describe the same `--help` surface. Each finding below is marked **VERIFIED** (stated plainly in vendor docs) or **UNVERIFIED** (not found in docs; this design states the conservative assumption it relies on and the adapter is built so a wrong assumption fails safely rather than silently).

1. **Positional argument vs. stdin — VERIFIED.** `kiro-cli chat --no-interactive "<prompt>"` passes the prompt as a positional argument; piping the instruction on stdin with no positional argument also works, and Kiro CLI reads the full stream as the instruction. The two input modes are mutually exclusive — supplying both is not documented and this design never does so.
2. **Windows command-line length limit — VERIFIED (general Windows behavior, not Kiro-CLI-specific).** `node:child_process.spawn` with `shell: false` (used throughout this project, e.g. `src/tts/tts.ts`) calls `CreateProcess` directly, whose documented argument-vector limit is 32,767 UTF-16 characters total across the command and all arguments. This is far above this project's prompt size: `buildPrompt` (`src/summarize/prompt.ts`) emits at most `OPENING_SENTENCE_COUNT` sentences plus one impact sentence from an already-length-capped `sourceText`, observed in practice at well under 2,000 characters. **Decision: pass the prompt as a positional argument**, matching the vendor's own first example and keeping the adapter's `ProcessSpec` identical in shape to the Piper adapter's (`args` only, no `stdin` needed) â€” see Requirement 1.2 and 1.4, which already name a positional-shaped call. Stdin is documented as a working fallback; this design does not need it, but the `ProcessSpec.stdin` field (already defined for the TTS runner) remains available unused so a future prompt-size increase can switch to it without an interface change.
3. **Flags to avoid trusting tools — VERIFIED.** `--no-interactive` by itself denies every tool call needing approval (`[denied] tool permission approval is not supported in non-interactive mode. Use --trust-all-tools to auto-approve.`) and the run completes with no tool executed. This is exactly Requirement 1.5 ("without trusting any tool"): the adapter passes neither `--trust-all-tools` nor `--trust-tools`, so the request is denied rather than approved, and the final reply text is whatever Kiro CLI printed before or instead of the denied call. No `--trust-tools=` (empty list) is passed either, since vendor docs separately warn an empty `--trust-tools=` can behave as trusting rather than as trusting nothing.
4. **The real "not logged in" stderr text — UNVERIFIED.** Vendor docs describe authentication precedence (stored login vs. `KIRO_API_KEY`) and exit codes (0 success; 1 general failure including "auth error"; 3 MCP startup failure; 4 agent/mode not found) but do not quote the literal stderr string Kiro CLI prints for an unauthenticated `chat` call, and this environment has no installed `kiro-cli` binary to reproduce it against. **Decision: detect "not logged in" by matching stderr case-insensitively against a small set of substrings** (`"not logged in"`, `"not authenticated"`, `"please log in"`, `"please run"` together with `"login"`) defined as a named constant array in `src/config/index.ts`, rather than a single exact string. This is deliberately permissive matching, not a parsed, versioned error code, because the exact text is unverified; Requirement 5.3's `not-logged-in` kind is best-effort detection, and any non-zero exit whose stderr does not match one of these substrings falls through to the general `non-zero-exit` kind (Requirement 5.4) with the exit code and a stderr excerpt, so a login failure is never silently swallowed â€” at worst it is reported under the more generic kind with the real message still visible to a human. The task list includes a manual verification task to run this against a real unauthenticated `kiro-cli` once available and tighten the match list.

## Architecture

```
scripts/build-briefing.ts
        │
        ▼
src/summarize/select-llm.ts   (selectLlmAdapter: LLM_MODE → Result<LlmAdapter, LlmError>)
        │
        ├──▶ src/summarize/llm.ts              (createEnvLlmAdapter — existing, unchanged)
        │
        └──▶ src/summarize/kiro-cli-adapter.ts (createKiroCliAdapter — new)
                     │
                     ├─▶ src/tts/tts.ts        (ProcessRunner, ProcessSpec, ProcessOutcome, createSpawnRunner — reused, not duplicated)
                     ├─▶ src/summarize/clean-kiro-cli-output.ts (pure Output_Cleaner)
                     └─▶ src/config/index.ts   (KIRO_CLI_BINARY, KIRO_CLI_TIMEOUT_MS, size/excerpt limits, not-logged-in substrings)
```

`summarize/summarize.ts` is unchanged: it already depends only on the `LlmAdapter` interface (`complete(req)`), so a `Kiro_Cli_Adapter` instance satisfies it without modification (Requirement 1.1).

Call sequence for one `complete(req)` on the Kiro CLI adapter:

```
complete({ prompt, signal })
  → build ProcessSpec: command = KIRO_CLI_BINARY, args = ["chat", "--no-interactive", prompt]
  → runner.run(spec, timeoutSignal)       (timeoutSignal combines req.signal and an internal timeout controller)
  → outcome: "exited" | "spawn-failed" | "aborted" | "timed-out"
      "spawn-failed"           → { ok:false, error:{ kind:"binary-not-found", ... } } when the message indicates ENOENT,
                                  else a generic spawn failure folded into "non-zero-exit"-shaped reporting (see Error Handling)
      "aborted" (req.signal)   → { ok:false, error:{ kind:"aborted", ... } }
      "aborted" (timeout)      → { ok:false, error:{ kind:"timeout", ... } }
      "exited", code !== 0     → stderr matched against not-logged-in substrings
                                    match    → { ok:false, error:{ kind:"not-logged-in", ... } }
                                    no match → { ok:false, error:{ kind:"non-zero-exit", ... } }
      "exited", code === 0     → cleaned = cleanKiroCliOutput(stdout)
                                    cleaned === "" → { ok:false, error:{ kind:"empty-output", ... } }
                                    else           → { ok:true, value: cleaned }
```

## Components and Interfaces

### Process runner reuse (`src/tts/tts.ts`, extended)

The existing `ProcessRunner.run(spec, signal)` already returns `ProcessOutcome` with `{ kind: "exited", code, stderr }`, which drops stdout. This design adds one new, backward-compatible outcome field rather than a second runner type:

```ts
// src/tts/tts.ts — additive change
export type ProcessOutcome =
  | { kind: "exited"; code: number; stderr: string; stdout?: string } // stdout added; optional, so TTS call sites are unaffected
  | { kind: "spawn-failed"; message: string }
  | { kind: "aborted" };

export interface ProcessSpec {
  command: string;
  args: readonly string[];
  stdin?: string;
  /** When true, the runner also captures stdout (bounded by captureLimitBytes). Default false (TTS behavior unchanged). */
  captureStdout?: boolean;
  /** Bounds captured stdout/stderr size (bytes). Defaults to the runner's existing 2000-char stderr cap when omitted. */
  captureLimitBytes?: number;
}
```

- `createSpawnRunner` is extended to append to a `stdout` buffer (capped at `captureLimitBytes`, same pattern as the existing `stderr` cap) only when `spec.captureStdout` is true, and to spawn with `stdio: ["pipe", "pipe", "pipe"]` instead of `["pipe", "ignore", "pipe"]` only for that call — the TTS call sites keep `captureStdout` unset, so their spawn options and behavior are byte-for-byte unchanged (Requirement 6.4 on the TTS side is preserved; this is a pure extension, not a behavior change to an existing caller).
- Both the Piper/Seed TTS adapters and the new Kiro CLI adapter now import `ProcessRunner` from the single `src/tts/tts.ts` module. This crosses the `tts` → `summarize` naming direction only in the sense of a shared utility import, not a layering violation: `src/types.ts`-style shared shapes belong in one place per `structure.md`, and `ProcessRunner` is exactly that kind of shared, no-I/O-opinion interface. No pipeline-stage logic is imported either way.

### Kiro_Cli_Adapter (`src/summarize/kiro-cli-adapter.ts`)

```ts
export interface KiroCliAdapterOptions {
  runner?: ProcessRunner;          // defaults to createSpawnRunner()
  binary?: string;                 // defaults to KIRO_CLI_BINARY
  timeoutMs?: number;              // defaults to KIRO_CLI_TIMEOUT_MS
  stdoutLimitBytes?: number;       // defaults to KIRO_CLI_STDOUT_LIMIT_BYTES
  stderrExcerptChars?: number;     // defaults to KIRO_CLI_STDERR_EXCERPT_CHARS
  notLoggedInHints?: readonly string[]; // defaults to KIRO_CLI_NOT_LOGGED_IN_HINTS
  now?: () => number;              // defaults to Date.now; for duration logging only
  logger?: Logger;                 // defaults to a no-op logger; createLogger() in production
}

export function createKiroCliAdapter(options?: KiroCliAdapterOptions): LlmAdapter;
```

- `complete(req)` builds `args = ["chat", "--no-interactive", req.prompt]` (Requirement 1.2) and calls `runner.run({ command: binary, args, captureStdout: true, captureLimitBytes: stdoutLimitBytes }, combinedSignal)` with no shell (Requirement 1.4 — `createSpawnRunner`'s `spawn(..., { shell: false, ... })` already guarantees this).
- `combinedSignal` is built from `req.signal` plus an internal `AbortController` fired by a `setTimeout(timeoutMs)`; the adapter distinguishes which one fired (by checking `req.signal.aborted` first) to report `aborted` vs. `timeout` (Requirement 4.2–4.4), and always clears the timer and removes listeners before returning so no child process and no timer outlives the call (Requirement 4.5).
- Passes neither `--trust-all-tools` nor `--trust-tools` (Requirement 1.5).
- Never throws: every branch of `ProcessOutcome`, including a `JSON`/parsing step that does not exist here (there is no JSON to parse — stdout is plain text through the Output_Cleaner), maps to a `Result` (Requirement 5.6).
- Logs at most one structured line per call: `{ event: "kiro-cli-complete", exitStatus, durationMs, errorKind? }` — never the prompt, stdout, cleaned reply, or any credential (Requirement 8.4, 8.5).
- Adds no runtime dependency: uses only `node:child_process` (via the shared runner) and `node:timers` (Requirement 6.3).

### Output_Cleaner (`src/summarize/clean-kiro-cli-output.ts`)

```ts
export function cleanKiroCliOutput(raw: string): string;
```

Pure function, no I/O, no clock, no randomness (Requirement 3.1). Pipeline of steps, each independently simple so idempotence (Requirement 3.8) holds by construction:

1. Normalize line endings: `\r\n` and `\r` → `\n`.
2. Strip ANSI escape sequences with a CSI-sequence regex (`\u001b\[[0-9;]*[A-Za-z]`) plus OSC sequences (`\u001b\][^\u0007]*\u0007`), covering the color/cursor codes a terminal UI prints even in `--no-interactive` mode.
3. Split into lines; drop leading lines that match known preamble/tool patterns: blank lines, lines matching a tool-use marker pattern (e.g. lines starting with `[tool]`, `🛠`, `●`, or the literal denial text from finding 3 above), and lines that are pure agent chrome (e.g. a leading `> ` prompt echo), stopping at the first line that is not one of these.
4. Drop any remaining embedded tool-use/tool-result blocks: lines between a tool-start marker and its matching tool-end marker are removed wherever they occur, not only at the head of the output, so a tool call that happens mid-reply does not leak into the script text (this generalizes Requirement 3.4 beyond "preceding" lines, which is the common case the requirement names).
5. Strip a single leading reply marker if present (e.g. a line that is exactly an assistant-turn marker character sequence) — Requirement 3.5.
6. Join remaining lines with `\n`, then `.trim()`.

Because steps 2–5 only ever remove text or normalize line endings, re-running the whole pipeline on its own output finds nothing left to remove and returns the same string (Requirement 3.8). Because a plain reply with none of the removable patterns matches no branch in steps 2–5, it passes through unchanged except for line-ending normalization and the final trim (Requirement 3.9).

### Llm_Selector (`src/summarize/select-llm.ts`)

```ts
export function selectLlmAdapter(
  mode: string | undefined = LLM_MODE,
  factories: { http?: () => LlmAdapter; kiroCli?: () => LlmAdapter } = {},
): Result<LlmAdapter, LlmError>;
```

- `mode` trimmed/normalized the same way `selectTtsAdapter` normalizes `engine` (`src/tts/tts.ts`): `(mode ?? "").trim().toLowerCase() || "http"`, so unset or empty means `'http'` (Requirement 2.4).
- `'http'` → `factories.http?.() ?? createEnvLlmAdapter(createHttpClient(), process.env)` (Requirement 2.3). Note `createEnvLlmAdapter` takes an `HttpClient` as its first argument, so the default factory also builds one; a caller that already has an `HttpClient` (as `build-briefing.ts` does) should pass `factories.http = () => createEnvLlmAdapter(http, process.env)` to reuse the one client the build already created, rather than letting the selector build a second one — `build-briefing.ts` is updated to do this (see Components below).
- `'kiro-cli'` → `factories.kiroCli?.() ?? createKiroCliAdapter()` (Requirement 2.5).
- Any other normalized value → `{ ok: false, error: { kind: "not-configured", message: `unknown LLM_MODE '${mode}'` } }`, constructing no adapter (Requirement 2.6) — mirrors `selectTtsAdapter`'s `unconfigured`-on-unknown-engine branch exactly.
- This is the only function in the codebase that constructs an `LlmAdapter` for production use outside a direct test fixture (Requirement 2.7); `FakeLlm` remains test-only and is untouched.
- Accepts injected mode and factories so tests never read `process.env.LLM_MODE` (Requirement 2.10).

### Build_Script (`scripts/build-briefing.ts`, updated)

```ts
const llm = selectLlmAdapter(process.env.LLM_MODE, { http: () => createEnvLlmAdapter(http, process.env) });
if (!llm.ok) {
  process.stderr.write(`build-briefing: ${llm.error.message}\n`);
  return 1;
}
// ...runPipeline({ ..., llm: llm.value, ... })
```

This follows the existing `tts`-selection shape in the same file exactly (Requirement 2.8, 2.9) and runs before `mkdirSync`/`runPipeline` so a misconfigured `LLM_MODE` fails before any ingest, LLM or TTS work starts (Requirement 2.9).

## Data Models

```ts
// src/summarize/llm.ts — LlmError extended, additive (Requirement 5.1)
export type LlmError =
  | { kind: "not-configured"; message: string }
  | { kind: "request-failed"; message: string }
  | { kind: "bad-response"; message: string }
  | { kind: "aborted"; message: string }
  | { kind: "binary-not-found"; message: string }
  | { kind: "not-logged-in"; message: string }
  | { kind: "non-zero-exit"; message: string; exitCode: number }
  | { kind: "timeout"; message: string }
  | { kind: "empty-output"; message: string };
```

```ts
// src/config/index.ts additions
/** kiro-cli executable, looked up on PATH (command name or absolute path). */
export const KIRO_CLI_BINARY = "kiro-cli";

/** Timeout for one Kiro CLI run (milliseconds). */
export const KIRO_CLI_TIMEOUT_MS = 120_000;

/** Max captured stdout for one Kiro CLI run, before cleaning (bytes). */
export const KIRO_CLI_STDOUT_LIMIT_BYTES = 200_000;

/** Length of the stderr excerpt included in a Kiro CLI error message (characters). */
export const KIRO_CLI_STDERR_EXCERPT_CHARS = 300;

/**
 * Case-insensitive substrings used to detect a "not logged in" failure in Kiro CLI stderr.
 * UNVERIFIED: the exact stderr text was not confirmed against a real unauthenticated run
 * (see design.md "Open items"). Any non-zero exit not matching one of these falls back to
 * the non-zero-exit kind, so a login failure is still reported, just under a more generic kind.
 */
export const KIRO_CLI_NOT_LOGGED_IN_HINTS = ["not logged in", "not authenticated", "please log in", "login"] as const;
```

`LlmRequest` (`{ prompt, signal }`) is reused unchanged from `src/summarize/llm.ts` (Requirement 1.6); this design adds no competing request shape.

## Correctness Properties

This design assesses property-based testing against the feature's two pure functions, `cleanKiroCliOutput` (Output_Cleaner) and the mode-dispatch logic inside `selectLlmAdapter`. The subprocess-running parts of `Kiro_Cli_Adapter` itself are integration-shaped (a fake `ProcessRunner` stands in for a real child process, and behavior is driven by a handful of discrete `ProcessOutcome` branches rather than a wide input space) and are covered by unit/example tests instead, consistent with `web-player`'s and `tts`'s existing split between property tests on pure cores and example tests on orchestration.

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Output_Cleaner removes all ANSI sequences and carriage returns

For any string `s`, `cleanKiroCliOutput(s)` returns a string containing no ANSI escape sequence and no `\r` character.

**Validates: Requirements 3.2, 3.6, 3.7**

### Property 2: Output_Cleaner is idempotent

For any string `s`, `cleanKiroCliOutput(cleanKiroCliOutput(s)) === cleanKiroCliOutput(s)`.

**Validates: Requirements 3.8**

### Property 3: Output_Cleaner is the identity on plain reply text

For any plain reply text `t` containing no ANSI sequence, no reply marker and no tool-use line, `cleanKiroCliOutput(t)` equals `t` with line endings normalized to `\n` and then trimmed.

**Validates: Requirements 3.9**

### Property 4: Output_Cleaner is metamorphically stable under added noise

For any plain reply text `t` (as in Property 3) and any combination of a preamble block, ANSI codes, and tool-use lines wrapped around or interleaved with `t`, `cleanKiroCliOutput(noisy)` equals `cleanKiroCliOutput(t)`.

**Validates: Requirements 3.10**

### Property 5: Output_Cleaner collapses all-removable input to empty

For any string composed entirely of removable text (ANSI sequences, preamble lines, tool-use lines, the reply marker, or any combination of these, with no plain reply text), `cleanKiroCliOutput(s)` returns the empty string. This includes the empty string itself.

**Validates: Requirements 3.11**

### Property 6: The selector is total and deterministic over its mode input

For any string `mode`, `selectLlmAdapter(mode, factories)` returns `{ ok: true }` with the HTTP adapter when the normalized mode is `'http'`, empty, or `undefined`; `{ ok: true }` with the Kiro CLI adapter when the normalized mode is `'kiro-cli'`; and `{ ok: false }` with a `not-configured` error naming `mode`, constructing neither adapter, for every other string — and the same `mode` always yields the same branch.

**Validates: Requirements 2.3, 2.4, 2.5, 2.6**

**Property reflection**: An earlier draft also considered a separate property for "unset/empty mode defaults to http" (Requirement 2.4) and another for "only 'kiro-cli' selects the Kiro CLI adapter" (2.5); both are subsumed by Property 6's single total case-split over all string inputs, which already includes the empty string and every non-matching string as cases. A separate round-trip-style property for the Output_Cleaner was considered ("clean(marker + t) == clean(t)") but is strictly a special case of Property 4's general noise-metamorphic property, so it was folded in rather than kept standalone.

## Error Handling

- Every `Kiro_Cli_Adapter` and `Llm_Selector` failure is a typed `LlmError` returned as `{ ok: false, error }`; nothing throws for an expected runtime outcome, including a spawn error (`ENOENT`), a timeout, an abort, a non-zero exit, or empty output (Requirement 5.6). A thrown error from a programmer mistake (e.g. a bug in the cleaner) is not caught specially and is allowed to propagate, per `structure.md`'s "throw only for programmer error" rule.
- `spawn-failed` outcomes are inspected for an `ENOENT`-shaped message (`err.code === "ENOENT"` surfaces as part of `Error.message` on the `SpawnedChild` `"error"` event in `src/tts/tts.ts`'s runner) to choose `binary-not-found` over a generic non-zero-exit-shaped report, satisfying Requirement 5.2's "cannot be started because it does not exist" condition precisely, rather than conflating every spawn failure with the binary-missing case.
- A `non-zero-exit` error's message always includes the exit code (Requirement 5.4) and, for every Kiro CLI error kind, the message is built from the error kind name, the exit code when one exists, and a `KIRO_CLI_STDERR_EXCERPT_CHARS`-length excerpt of stderr only — never the full stderr, the prompt, or stdout (Requirement 5.7, 8.4).
- The adapter never retries a failed run (Requirement 5.8): unlike the HTTP adapter and the TTS adapters, which retry via `HTTP_RETRY_COUNT` on transient network failures, a Kiro CLI run spends Kiro credits per attempt, so `complete(req)` calls the runner exactly once regardless of outcome.
- `selectLlmAdapter`'s unknown-mode branch logs nothing itself; `build-briefing.ts` is responsible for logging the error kind and message and exiting non-zero before any pipeline work starts (Requirement 2.9), mirroring how the same file already handles `selectTtsAdapter`'s error case.
- The `not-logged-in` detection is explicitly best-effort (see "Open items" above): a false negative (an actual login failure reported as `non-zero-exit`) is an acceptable degraded outcome because the generic message still carries the exit code and a stderr excerpt for a human to read; a false positive is considered unlikely given the hint list is checked only on a non-zero exit, where "login" appearing in stderr is overwhelmingly likely to mean an authentication problem.

## Testing Strategy

**Property-based tests** (fast-check, already a project dependency; minimum `PROPERTY_TEST_RUNS` = 100 runs each, one test per property, tagged `// Feature: kiro-cli-llm-mode, Property N: <title>`):

1. **Property 1** (`src/summarize/clean-kiro-cli-output.property.test.ts`): generator produces random strings interleaved with random ANSI CSI/OSC sequences and `\r`/`\r\n` line endings.
2. **Property 2** (same file): generator produces arbitrary strings (including already-clean ones); asserts the fixed point.
3. **Property 3** (same file): generator produces plain multi-line text drawn from a restricted alphabet guaranteed not to contain `\u001b`, the reply marker, or a tool-line prefix.
4. **Property 4** (same file): generator composes a Property-3-style plain text with randomly placed preamble lines, ANSI codes, and tool-use/tool-result line blocks before, after, and interleaved within it.
5. **Property 5** (same file): generator produces strings built only from the removable-pattern vocabulary (ANSI codes, preamble lines, tool-use lines, the marker) in random order and repetition, plus the empty string as an explicit example case.
6. **Property 6** (`src/summarize/select-llm.property.test.ts`): generator produces arbitrary strings plus the two valid mode strings and `undefined`/empty-string cases as explicit examples; asserts the three-way branch and that the returned `ok`/adapter-kind pairing is stable across repeated calls with the same input.

**Unit and example tests** (not property-based, per the PBT-applicability assessment above):

- `kiro-cli-adapter.test.ts`: using a fake `ProcessRunner` (no real `kiro-cli` spawned, matching Requirement 6.2) — successful run with trailing noise cleaned; non-zero exit with a not-logged-in-shaped stderr → `not-logged-in`; non-zero exit with unrelated stderr → `non-zero-exit` with the exit code in the message; `spawn-failed` with an `ENOENT`-shaped message → `binary-not-found`; exit 0 with only-removable stdout → `empty-output`; a fake runner that never resolves, combined with a short injected `timeoutMs`, → `timeout`, and asserts the runner was asked to kill the child; `req.signal` pre-aborted → `aborted` with the runner never invoked or immediately cancelled; asserts the built `args` array is exactly `["chat", "--no-interactive", prompt]` with no `--trust-*` flag present; asserts the logged line never contains the prompt or stdout text (string-search assertion against the fake logger's captured calls).
- `select-llm.test.ts`: `'http'`, empty string, and `undefined` all return the HTTP adapter from the injected `http` factory (not a freshly constructed one, verified by reference equality to a sentinel returned by the fake factory); `'kiro-cli'` returns the Kiro CLI adapter from the injected `kiroCli` factory; `'KIRO-CLI'` (case) and `' kiro-cli '` (whitespace) also select it, matching the normalization rule; an unknown string returns `{ ok: false }` with `not-configured` and neither factory was called (asserted via call-count on both fakes).
- `build-briefing` integration-level test (extends the existing `src/pipeline/run.*.test.ts` style, or a new `scripts/build-briefing.llm-mode.test.ts` if the script is made importable for testing — see task list): asserts that with `LLM_MODE` unset the pipeline still uses the HTTP path (no behavior change, Requirement 10.1, 10.2), and that an unknown `LLM_MODE` value causes the script to exit 1 before `runPipeline` is called (verified via a fake `runPipeline`/module seam, not a real spawned process, to keep the test fast and offline).
- An import-boundary test (same style as `web-player`'s, extended or a new assertion in it) statically scans `src/web/**/*.ts` and confirms none resolves to `src/summarize/kiro-cli-adapter.ts` or `src/summarize/select-llm.ts` (Requirement 8.1, 8.2).
- No test spawns a real `kiro-cli` process; `test/helpers/no-network.ts`'s existing guarantee covers the HTTP adapter's network calls, and the fake `ProcessRunner` covers the subprocess adapter the same way the existing Piper/Seed TTS tests already avoid a real `piper`/`ffmpeg`/OpenRouter call.
- **Manual follow-up, not a test task**: once a real `kiro-cli` binary is available and logged out, run it once by hand to capture the literal "not logged in" stderr text and tighten `KIRO_CLI_NOT_LOGGED_IN_HINTS` and the matching unit test fixture. This is called out explicitly in the task list as a non-coding follow-up, since the design cannot verify it in this environment.
