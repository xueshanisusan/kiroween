import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FFMPEG_BINARY, PIPER_BINARY } from "../config/index.js";
import { ASSUMED_TTS_AUDIO_FORMAT } from "../config/tts-format.js";
import { measureMp3DurationSeconds } from "../publish/duration.js";
import { createFakeTtsAdapter } from "./fake.js";
import {
  createLocalTtsAdapter,
  createSpawnRunner,
  type ProcessOutcome,
  type ProcessRunner,
  type ProcessSpec,
  type SpawnedChild,
} from "./tts.js";

const signal = new AbortController().signal;

/** Fake runner: records specs and writes the output file named in the args. */
function fakeRunner(behaviour: (spec: ProcessSpec, call: number) => ProcessOutcome | Promise<ProcessOutcome> = () => ({ kind: "exited", code: 0, stderr: "" })) {
  const calls: ProcessSpec[] = [];
  const runner: ProcessRunner = {
    async run(spec) {
      calls.push(spec);
      const outcome = await behaviour(spec, calls.length);
      if (outcome.kind === "exited" && outcome.code === 0) {
        const out = spec.args[spec.args.length - 1] as string;
        const target = spec.command === PIPER_BINARY ? (spec.args[spec.args.indexOf("--output_file") + 1] as string) : out;
        await writeFile(target, Buffer.from([1, 2, 3]));
      }
      return outcome;
    },
  };
  return { runner, calls };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tts-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local TTS adapter arguments", () => {
  it("runs piper with the script on stdin, then one ffmpeg call with the pinned arguments", async () => {
    const { runner, calls } = fakeRunner();
    const res = await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("hello world", "voice-a", signal);
    expect(res).toEqual({ ok: true, value: Buffer.from([1, 2, 3]) });
    expect(calls).toHaveLength(2);
    const [piper, ffmpeg] = calls as [ProcessSpec, ProcessSpec];
    expect(piper.command).toBe(PIPER_BINARY);
    expect(piper.stdin).toBe("hello world");
    expect(piper.args.join(" ")).not.toContain("hello world");
    expect(piper.args[piper.args.indexOf("--model") + 1]).toMatch(/voice-a\.onnx$/);
    expect(ffmpeg.command).toBe(FFMPEG_BINARY);
    const a = ffmpeg.args;
    expect(a[a.indexOf("-ar") + 1]).toBe("24000");
    expect(a[a.indexOf("-ar") + 1]).toBe(String(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz));
    expect(a[a.indexOf("-ac") + 1]).toBe("1");
    expect(a[a.indexOf("-c:a") + 1]).toBe("libmp3lame");
    expect(a[a.indexOf("-b:a") + 1]).toBe("48k");
  });

  it("a changed constant changes the ffmpeg arguments", async () => {
    const fmt = ASSUMED_TTS_AUDIO_FORMAT as { sampleRateHz: number; channels: number; fakeBitrateKbps: number };
    const original = { ...fmt };
    try {
      fmt.sampleRateHz = 22050;
      fmt.channels = 2;
      fmt.fakeBitrateKbps = 64;
      const { runner, calls } = fakeRunner();
      await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("x", "v", signal);
      const a = (calls[1] as ProcessSpec).args;
      expect(a[a.indexOf("-ar") + 1]).toBe("22050");
      expect(a[a.indexOf("-ac") + 1]).toBe("2");
      expect(a[a.indexOf("-b:a") + 1]).toBe("64k");
    } finally {
      Object.assign(fmt, original);
    }
  });

  it("removes temp files on success", async () => {
    const { runner } = fakeRunner();
    await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("x", "v", signal);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("local TTS adapter failures", () => {
  it("retries once on non-zero exit, then returns a typed error and cleans up", async () => {
    const { runner, calls } = fakeRunner(() => ({ kind: "exited", code: 1, stderr: "bad model" }));
    const res = await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("x", "v", signal);
    expect(calls).toHaveLength(2); // piper twice, never reaches ffmpeg
    expect(res).toEqual({
      ok: false,
      error: { kind: "request", message: `${PIPER_BINARY} exited with code 1: bad model`, attempts: 2 },
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("returns a typed error when the binary cannot start", async () => {
    const { runner } = fakeRunner(() => ({ kind: "spawn-failed", message: "ENOENT" }));
    const res = await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("x", "v", signal);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("request");
      expect(res.error.attempts).toBe(2);
      expect(res.error.message).toContain("ENOENT");
    }
  });

  it("succeeds when the retry succeeds", async () => {
    const { runner } = fakeRunner((_s, call) => (call === 1 ? { kind: "exited", code: 1, stderr: "" } : { kind: "exited", code: 0, stderr: "" }));
    const res = await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("x", "v", signal);
    expect(res.ok).toBe(true);
  });

  it("does not retry after abort", async () => {
    const ctl = new AbortController();
    const { runner, calls } = fakeRunner(() => {
      ctl.abort();
      return { kind: "aborted" };
    });
    const res = await createLocalTtsAdapter({ runner, tempRoot: root }).synthesize("x", "v", ctl.signal);
    expect(calls).toHaveLength(1);
    expect(res).toEqual({ ok: false, error: { kind: "aborted", message: "aborted", attempts: 1 } });
    expect(await readdir(root)).toEqual([]);
  });
});

describe("spawn runner", () => {
  function fakeChild() {
    const child = new EventEmitter() as EventEmitter & SpawnedChild & { killed: string | undefined; written: string };
    child.killed = undefined;
    child.written = "";
    child.kill = (sig) => {
      child.killed = String(sig);
      return true;
    };
    child.stdin = { write: (d: string) => (child.written += d), end: () => undefined, on: () => undefined };
    child.stderr = { on: () => undefined };
    return child;
  }

  it("abort kills the child process", async () => {
    const child = fakeChild();
    const ctl = new AbortController();
    const p = createSpawnRunner(() => child).run({ command: "x", args: [], stdin: "s" }, ctl.signal);
    ctl.abort();
    expect(await p).toEqual({ kind: "aborted" });
    expect(child.killed).toBe("SIGKILL");
    expect(child.written).toBe("s");
  });

  it("reports exit code and spawn errors", async () => {
    const c1 = fakeChild();
    const p1 = createSpawnRunner(() => c1).run({ command: "x", args: [] }, signal);
    c1.emit("close", 3);
    expect(await p1).toEqual({ kind: "exited", code: 3, stderr: "" });

    const c2 = fakeChild();
    const p2 = createSpawnRunner(() => c2).run({ command: "x", args: [] }, signal);
    c2.emit("error", new Error("ENOENT"));
    expect(await p2).toEqual({ kind: "spawn-failed", message: "ENOENT" });
  });
});

describe("fake TTS adapter", () => {
  it("returns a measurable MP3 of about 35 seconds", async () => {
    const res = await createFakeTtsAdapter().synthesize("s", "v", signal);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const d = measureMp3DurationSeconds(res.value);
      expect(d.ok).toBe(true);
      if (d.ok) expect(Math.abs(d.value - 35)).toBeLessThan(1);
    }
  });
});
