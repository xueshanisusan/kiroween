import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../src/lib/http.js";
import type { runPipeline } from "../src/pipeline/run.js";
import type { ProcessOutcome, ProcessRunner, ProcessSpec } from "../src/tts/tts.js";
import { main } from "../scripts/build-briefing.js";

type Deps = Parameters<typeof runPipeline>[0];

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "build-briefing-"));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function setup(envExtra: Record<string, string>) {
  const captured: Deps[] = [];
  const run = vi.fn(async (deps: Deps) => {
    captured.push(deps);
    return { status: "unchanged" } as const;
  });
  const httpRequests: string[] = [];
  const http: HttpClient = {
    async request(req) {
      httpRequests.push(req.url);
      return { ok: true, value: { status: 200, body: JSON.stringify({ choices: [{ message: { content: "http reply" } }] }), headers: {} } } as never;
    },
  };
  const specs: ProcessSpec[] = [];
  const runner: ProcessRunner = {
    async run(spec): Promise<ProcessOutcome> {
      specs.push(spec);
      return { kind: "exited", code: 0, stderr: "", stdout: "kiro reply" };
    },
  };
  const stderrChunks: string[] = [];
  const env = { BRIEFING_DATA_DIR: dataDir, ...envExtra };
  const exec = () =>
    main({ env, http, runner, runPipeline: run as unknown as typeof runPipeline, stderr: { write: (t) => stderrChunks.push(t) } });
  return { run, captured, httpRequests, specs, stderrChunks, exec };
}

const HTTP_ENV = { LLM_API_KEY: "k", LLM_API_URL: "https://llm.example/v1", LLM_MODEL: "m" };

describe("build-briefing LLM mode wiring", () => {
  it("uses the HTTP adapter when LLM_MODE is unset", async () => {
    const t = setup(HTTP_ENV);
    expect(await t.exec()).toBe(0);
    expect(t.run).toHaveBeenCalledTimes(1);
    const res = await t.captured[0]!.llm.complete({ prompt: "p", signal: new AbortController().signal });
    expect(res).toEqual({ ok: true, value: "http reply" });
    expect(t.httpRequests).toEqual(["https://llm.example/v1"]);
    expect(t.specs).toHaveLength(0);
  });

  it("exits 1 and never calls runPipeline for an unknown LLM_MODE", async () => {
    const t = setup({ ...HTTP_ENV, LLM_MODE: "bogus" });
    expect(await t.exec()).toBe(1);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.stderrChunks.join("")).toContain("unknown LLM_MODE 'bogus'");
  });

  it("passes the Kiro CLI adapter (not HTTP) to runPipeline for LLM_MODE=kiro-cli", async () => {
    const t = setup({ ...HTTP_ENV, LLM_MODE: "kiro-cli" });
    expect(await t.exec()).toBe(0);
    expect(t.run).toHaveBeenCalledTimes(1);
    const res = await t.captured[0]!.llm.complete({ prompt: "hello", signal: new AbortController().signal });
    expect(res).toEqual({ ok: true, value: "kiro reply" });
    expect(t.specs).toHaveLength(1);
    expect(t.specs[0]!.args).toEqual(["chat", "--no-interactive", "hello"]);
    expect(t.httpRequests).toHaveLength(0);
  });
});
