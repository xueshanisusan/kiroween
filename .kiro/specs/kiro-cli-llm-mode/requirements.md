# Requirements Document

## Introduction

The summarize step of the briefing pipeline calls an `LlmAdapter` (`src/summarize/llm.ts`). Today the only implementation, `createEnvLlmAdapter(http, env)`, POSTs to an HTTP endpoint using `LLM_API_KEY`, `LLM_API_URL` and `LLM_MODEL`. The project owner has no API key and wants to spend Kiro credits instead.

This feature adds a second implementation that runs `kiro-cli chat --no-interactive` as a subprocess, plus a mode switch chosen by the `LLM_MODE` environment variable (`'http'` or `'kiro-cli'`, default `'http'`). The switch mirrors how `TTS_ENGINE` selects the TTS adapter through `selectTtsAdapter`. The batch script `scripts/build-briefing.ts` uses the selector. The default keeps today's behavior unchanged.

The Kiro CLI adapter runs only in the batch job. No LLM call happens at request time. Kiro CLI uses its own login, so this project holds no credential for it.

## Glossary

- **Llm_Adapter**: The `LlmAdapter` interface in `src/summarize/llm.ts`, with one method `complete(req)` that returns `Result<string, LlmError>`.
- **Http_Llm_Adapter**: The existing adapter created by `createEnvLlmAdapter`.
- **Kiro_Cli_Adapter**: The new `LlmAdapter` implementation that runs the Kiro CLI as a subprocess.
- **Kiro_Cli**: The `kiro-cli` executable, run as `kiro-cli chat --no-interactive`.
- **Llm_Mode**: The value of `LLM_MODE`, one of `'http'` or `'kiro-cli'`. Unset or empty means `'http'`.
- **Llm_Selector**: The single function that maps Llm_Mode to an Llm_Adapter, analogous to `selectTtsAdapter`.
- **Process_Runner**: An injected interface that runs one child process and reports its outcome. The real implementation wraps `node:child_process`. Tests pass a fake.
- **Output_Cleaner**: The pure function that turns raw Kiro_Cli stdout into clean script text.
- **Raw_Output**: The stdout text captured from one Kiro_Cli run, before cleaning.
- **Config**: The `src/config/` module, where named constants and environment-derived settings live.
- **Build_Script**: `scripts/build-briefing.ts`, the batch entry point.
- **Llm_Error**: The `LlmError` union in `src/summarize/llm.ts`, extended by this feature with Kiro CLI error kinds.

## Requirements

### Requirement 1: Run the summarizer through Kiro CLI

**User Story:** As the project owner, I want to run the summarize step through Kiro CLI, so that I can spend Kiro credits and need no LLM API key.

#### Acceptance Criteria

1. THE Kiro_Cli_Adapter SHALL implement the Llm_Adapter interface, so that `summarize/summarize.ts` accepts the Kiro_Cli_Adapter without modification.
2. WHEN `complete(req)` is called, THE Kiro_Cli_Adapter SHALL run Kiro_Cli with the arguments `chat` and `--no-interactive` and with `req.prompt` as the chat input.
3. WHEN Kiro_Cli exits with code 0 and the cleaned output is non-empty, THE Kiro_Cli_Adapter SHALL return `{ ok: true, value }` where `value` is the Output_Cleaner result for the Raw_Output.
4. THE Kiro_Cli_Adapter SHALL run Kiro_Cli without a shell, passing arguments as an array.
5. THE Kiro_Cli_Adapter SHALL run Kiro_Cli without trusting any tool, so that article text in the prompt cannot cause Kiro_Cli to run a tool.
6. WHEN the Kiro_Cli_Adapter runs Kiro_Cli, THE Kiro_Cli_Adapter SHALL use the same `LlmRequest` shape (`prompt`, `signal`) as the Http_Llm_Adapter.

### Requirement 2: Select the LLM mode by environment variable

**User Story:** As the project owner, I want to choose the LLM mode with an environment variable, so that I can switch between the HTTP endpoint and Kiro CLI without editing code.

#### Acceptance Criteria

1. THE Config SHALL export `LLM_MODE`, read from the `LLM_MODE` environment variable, with the value `'http'` when the variable is unset.
2. THE Config SHALL document the unit and the allowed values of `LLM_MODE` in a comment beside the constant.
3. WHEN Llm_Mode is `'http'`, THE Llm_Selector SHALL return the Http_Llm_Adapter.
4. WHEN Llm_Mode is unset or an empty string, THE Llm_Selector SHALL return the Http_Llm_Adapter, so that existing behavior is unchanged.
5. WHEN Llm_Mode is `'kiro-cli'`, THE Llm_Selector SHALL return the Kiro_Cli_Adapter.
6. IF Llm_Mode is any other value, THEN THE Llm_Selector SHALL return `{ ok: false }` with an Llm_Error of kind `not-configured` that names the unknown value, and THE Llm_Selector SHALL construct no adapter.
7. THE Llm_Selector SHALL be the only place that chooses an Llm_Adapter implementation.
8. THE Build_Script SHALL obtain its Llm_Adapter from the Llm_Selector.
9. IF the Llm_Selector returns an error, THEN THE Build_Script SHALL log the error kind and message, and SHALL exit with a non-zero status before any ingest, LLM or TTS work starts.
10. THE Llm_Selector SHALL accept an injected mode value and injected adapter factories, so that tests select a mode without reading the process environment.

### Requirement 3: Clean the Kiro CLI output

**User Story:** As the project owner, I want the Kiro CLI reply cleaned, so that the summarizer receives only script text.

#### Acceptance Criteria

1. THE Output_Cleaner SHALL be a pure function from a string to a string, with no I/O, no clock and no randomness.
2. THE Output_Cleaner SHALL remove ANSI escape sequences from the Raw_Output.
3. THE Output_Cleaner SHALL remove agent preamble lines that precede the reply text.
4. THE Output_Cleaner SHALL remove tool-use lines and tool-result lines from the Raw_Output.
5. THE Output_Cleaner SHALL remove the leading reply marker that Kiro_Cli prints before the reply text.
6. THE Output_Cleaner SHALL normalize line endings to `\n` and trim leading and trailing whitespace.
7. FOR ALL strings `s`, THE Output_Cleaner SHALL return a string that contains no ANSI escape sequence and no `\r` character.
8. FOR ALL strings `s`, THE Output_Cleaner SHALL satisfy `clean(clean(s)) == clean(s)` (idempotence).
9. FOR ALL plain reply texts `t` that contain no ANSI sequence, no marker and no tool-use line, THE Output_Cleaner SHALL satisfy `clean(t) == t.trim()` after line-ending normalization.
10. FOR ALL plain reply texts `t` and any preamble, ANSI codes and tool-use lines added around `t`, THE Output_Cleaner SHALL return the same text as for `t` alone (metamorphic property).
11. WHEN the Output_Cleaner receives an empty string or a string that holds only removable text, THE Output_Cleaner SHALL return an empty string.

### Requirement 4: Bound the Kiro CLI run with a timeout

**User Story:** As the project owner, I want the Kiro CLI run bounded by a timeout, so that a hung subprocess cannot stall the batch job.

#### Acceptance Criteria

1. THE Config SHALL export `KIRO_CLI_TIMEOUT_MS`, a named constant with a comment that states its unit is milliseconds.
2. WHEN a Kiro_Cli run lasts longer than `KIRO_CLI_TIMEOUT_MS`, THE Kiro_Cli_Adapter SHALL terminate the child process and return an Llm_Error of kind `timeout`.
3. WHEN `req.signal` is aborted before or during a run, THE Kiro_Cli_Adapter SHALL terminate the child process and return an Llm_Error of kind `aborted`.
4. THE Kiro_Cli_Adapter SHALL distinguish a `timeout` from an `aborted` outcome, so that the caller can tell a slow subprocess from a caller cancellation.
5. WHEN `complete(req)` returns, THE Kiro_Cli_Adapter SHALL leave no child process running.

### Requirement 5: Report typed Kiro CLI errors

**User Story:** As the project owner, I want typed errors for each Kiro CLI failure, so that I can tell a missing install from a missing login.

#### Acceptance Criteria

1. THE Llm_Error union SHALL include the kinds `binary-not-found`, `not-logged-in`, `non-zero-exit`, `timeout` and `empty-output`, in addition to the existing kinds.
2. IF the Process_Runner reports that the Kiro_Cli executable cannot be started because it does not exist, THEN THE Kiro_Cli_Adapter SHALL return an Llm_Error of kind `binary-not-found` whose message names the binary and says to install Kiro CLI.
3. IF Kiro_Cli exits with a non-zero code and its stderr indicates the user is not logged in, THEN THE Kiro_Cli_Adapter SHALL return an Llm_Error of kind `not-logged-in` whose message says to run `kiro-cli login`.
4. IF Kiro_Cli exits with a non-zero code for any other reason, THEN THE Kiro_Cli_Adapter SHALL return an Llm_Error of kind `non-zero-exit` whose message includes the exit code.
5. IF Kiro_Cli exits with code 0 and the Output_Cleaner returns an empty string, THEN THE Kiro_Cli_Adapter SHALL return an Llm_Error of kind `empty-output`.
6. THE Kiro_Cli_Adapter SHALL return every failure as `{ ok: false, error }` and SHALL NOT throw for any runtime outcome of the subprocess, including spawn errors.
7. WHEN the Kiro_Cli_Adapter reports an error, THE Kiro_Cli_Adapter SHALL limit the message to the error kind, the exit code and a fixed-length excerpt of stderr, with the excerpt length defined as a named constant in Config.
8. THE Kiro_Cli_Adapter SHALL NOT retry a failed run, because each run spends Kiro credits.

### Requirement 6: Test the adapter without the real CLI

**User Story:** As the project owner, I want the Kiro CLI adapter testable without the real CLI, so that tests are free, offline and deterministic.

#### Acceptance Criteria

1. THE Kiro_Cli_Adapter SHALL receive a Process_Runner through its options and SHALL default to a runner built on `node:child_process`.
2. WHEN tests run, THE test suite SHALL pass a fake Process_Runner and SHALL NOT spawn `kiro-cli`.
3. THE Kiro_Cli_Adapter SHALL add no runtime dependency to `package.json`.
4. THE Process_Runner for the Kiro_Cli_Adapter SHALL capture stdout and stderr, because the existing TTS runner ignores stdout.
5. THE Kiro_Cli_Adapter SHALL bound the captured stdout and stderr sizes with named constants in Config, so that runaway output cannot exhaust memory.

### Requirement 7: Keep binary name and limits in Config

**User Story:** As the project owner, I want the binary name and limits in Config, so that I can tune them without editing a module.

#### Acceptance Criteria

1. THE Config SHALL export `KIRO_CLI_BINARY`, a named constant whose default value is `'kiro-cli'`.
2. THE Config SHALL export `KIRO_CLI_TIMEOUT_MS`, defined in Requirement 4.1.
3. THE Config SHALL export the stderr excerpt length and the captured output size limits as named constants, each with a comment that states its unit.
4. THE Kiro_Cli_Adapter SHALL read the binary name, the timeout and the size limits from Config or from injected options that default to Config.

### Requirement 8: Respect project boundary rules

**User Story:** As a maintainer, I want the subprocess adapter to respect the project's boundary rules, so that the architecture stays consistent.

#### Acceptance Criteria

1. THE Kiro_Cli_Adapter SHALL run only in the batch job started by the Build_Script, and the web handler and phone webhook SHALL import neither the Kiro_Cli_Adapter nor the Llm_Selector.
2. WHEN a request is served by the web player or the phone webhook, THE System SHALL make no Kiro_Cli call.
3. THE Kiro_Cli_Adapter SHALL NOT use `src/lib/http.ts`, because the adapter makes no network call from project code.
4. THE Kiro_Cli_Adapter SHALL NOT log the prompt, the Raw_Output, the cleaned reply or any credential.
5. WHEN a Kiro_Cli run completes, THE Kiro_Cli_Adapter SHALL emit at most the exit status, the duration in milliseconds and the error kind to the structured log.
6. THE Kiro_Cli_Adapter SHALL rely on the Kiro_Cli login and SHALL read no credential from the environment.
7. WHEN Llm_Mode is `'kiro-cli'`, THE Build_Script SHALL need none of `LLM_API_KEY`, `LLM_API_URL` and `LLM_MODEL`.
8. THE new source files SHALL use kebab-case names and named exports only, and SHALL contain no `any` type and no default export.

### Requirement 9: Document the new mode

**User Story:** As a new contributor, I want the documentation to describe the new mode, so that I can set it up from a clean checkout.

#### Acceptance Criteria

1. THE README SHALL describe `LLM_MODE`, its two values and its default, and SHALL state that `'kiro-cli'` needs Kiro CLI installed and logged in.
2. THE README SHALL state that `'kiro-cli'` spends Kiro credits and runs only in the batch job.
3. THE `.env.example` file SHALL list the variable name `LLM_MODE` with no secret value.
4. THE `.kiro/steering/tech.md` file SHALL state that the Kiro_Cli_Adapter is the one LLM call that does not go through `src/lib/http.ts`, and SHALL give the reason that the adapter is a local subprocess and not a network call from project code.
5. THE `.kiro/steering/tech.md` file SHALL state that the Kiro_Cli_Adapter adds no runtime dependency.
6. WHEN the documentation is updated, THE documentation change SHALL be made without reading any `.env` file.

### Requirement 10: Preserve existing HTTP behavior

**User Story:** As a maintainer, I want existing behavior preserved, so that this feature changes nothing for users of the HTTP mode.

#### Acceptance Criteria

1. WHEN Llm_Mode is `'http'`, THE Http_Llm_Adapter SHALL behave as it does before this feature, including the `not-configured` error when `LLM_API_KEY`, `LLM_API_URL` or `LLM_MODEL` is missing.
2. THE existing tests for `createEnvLlmAdapter` and `FakeLlm` SHALL pass without modification.
3. WHEN the Llm_Error union gains new kinds, THE existing callers of `LlmAdapter.complete` SHALL continue to compile and to treat every error as a failed story.
