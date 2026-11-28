import { describe, expect, it } from "vitest";
import type { ProcessOutcome, ProcessRunner, ProcessSpec } from "../tts/tts.js";
import { createKiroCliAdapter } from "./kiro-cli-adapter.js";

const PROMPT = "SECRET-PROMPT-TEXT summarize this";

interface Seen {
  spec: ProcessSpec;
  signal: AbortSignal;
}

function fakeRunner(reply: ProcessOutcome | ((spec: ProcessSpec, signal: AbortSignal) => Promise<ProcessOutcome>)) {
  const seen: Seen[] = [];
  const runner: ProcessRunner = {
    run(spec, signal) {
      seen.push({ spec, signal });
      return typeof reply === "function" ? reply(spec, signal) : Promise.resolve(reply);
    },
  };
  return { runner, seen };
}

function fakeLogger() {
  const calls: { msg: string; fields: unknown }[] = [];
  return {
    calls,
    logger: {
      info: (msg: string, fields?: unknown) => {
        calls.push({ msg, fields });
      },
    },
  };
}

function setup(reply: Parameters<typeof fakeRunner>[0], timeoutMs = 5000) {
  const r = fakeRunner(reply);
  const l = fakeLogger();
  const adapter = createKiroCliAdapter({ runner: r.runner, logger: l.logger as never, timeoutMs });
  return { ...r, ...l, adapter };
}

const live = (): AbortSignal => new AbortController().signal;

describe("kiro-cli adapter", () => {
  it("returns cleaned text and passes exact args", async () => {
    const stdout = "\u001b[32m[tool: fs_read]\u001b[0m\n> Cleaned reply text.\n";
    const t = setup({ kind: "exited", code: 0, stderr: "", stdout });
    const res = await t.adapter.complete({ prompt: PROMPT, signal: live() });
    expect(res).toEqual({ ok: true, value: "Cleaned reply text." });
    expect(t.seen).toHaveLength(1);
    const spec = t.seen[0]!.spec;
    expect(spec.args).toEqual(["chat", "--no-interactive", PROMPT]);
    expect(spec.args.some((a) => a.startsWith("--trust"))).toBe(false);
    expect(spec.captureStdout).toBe(true);
    expect(t.calls.length).toBeLessThanOrEqual(1);
    const logged = JSON.stringify(t.calls);
    expect(logged).not.toContain("SECRET-PROMPT-TEXT");
    expect(logged).not.toContain("Cleaned reply text");
  });

  it("maps not-logged-in stderr", async () => {
    const t = setup({ kind: "exited", code: 1, stderr: "Error: Not logged in", stdout: "" });
    const res = await t.adapter.complete({ prompt: PROMPT, signal: live() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("not-logged-in");
    expect(t.calls).toHaveLength(1);
    expect(JSON.stringify(t.calls)).not.toContain("SECRET-PROMPT-TEXT");
  });

  it("maps unrelated non-zero exit with exitCode", async () => {
    const t = setup({ kind: "exited", code: 7, stderr: "boom", stdout: "leaked-stdout" });
    const res = await t.adapter.complete({ prompt: PROMPT, signal: live() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("non-zero-exit");
      if (res.error.kind === "non-zero-exit") expect(res.error.exitCode).toBe(7);
    }
    expect(JSON.stringify(t.calls)).not.toContain("leaked-stdout");
  });

  it("maps ENOENT spawn failure to binary-not-found", async () => {
    const t = setup({ kind: "spawn-failed", message: "spawn kiro-cli ENOENT" });
    const res = await t.adapter.complete({ prompt: PROMPT, signal: live() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("binary-not-found");
    expect(t.calls).toHaveLength(1);
  });

  it("maps exit 0 with only removable stdout to empty-output", async () => {
    const t = setup({ kind: "exited", code: 0, stderr: "", stdout: "\u001b[0m\n[tool: x]\n\n" });
    const res = await t.adapter.complete({ prompt: PROMPT, signal: live() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("empty-output");
  });

  it("times out when the runner never resolves, and aborts the runner", async () => {
    const t = setup(
      (_spec, signal) =>
        new Promise<ProcessOutcome>((resolve) => {
          signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
        }),
      20,
    );
    const res = await t.adapter.complete({ prompt: PROMPT, signal: live() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");
    expect(t.seen[0]!.signal.aborted).toBe(true);
    expect(t.calls.length).toBeLessThanOrEqual(1);
  });

  it("returns aborted for a pre-aborted signal without running", async () => {
    const t = setup({ kind: "exited", code: 0, stderr: "", stdout: "x" });
    const ac = new AbortController();
    ac.abort();
    const res = await t.adapter.complete({ prompt: PROMPT, signal: ac.signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("aborted");
    expect(t.seen).toHaveLength(0);
    expect(t.calls.length).toBeLessThanOrEqual(1);
  });
});
