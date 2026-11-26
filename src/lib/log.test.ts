import { describe, expect, it } from "vitest";
import { createLogger } from "./log.js";

function make(secrets: string[] = []) {
  const lines: string[] = [];
  const log = createLogger({ briefingId: "b-1", write: (l) => lines.push(l), secrets });
  return { log, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe("Logger", () => {
  it("writes JSON lines with briefingId, stage, outcome and elapsed ms", () => {
    const { log, parsed } = make();
    log.stageOk("ingest", 12);
    expect(parsed()[0]).toEqual({ briefingId: "b-1", stage: "ingest", outcome: "ok", elapsedMs: 12 });
  });

  it("includes the typed error code on failure", () => {
    const { log, parsed } = make();
    log.stageFailed("tts", 5, "tts-failed");
    expect(parsed()[0]).toMatchObject({ stage: "tts", outcome: "failed", errorCode: "tts-failed", briefingId: "b-1" });
  });

  it("puts briefingId on info lines and ignores a caller override", () => {
    const { log, parsed } = make();
    log.info("drop", { guid: "g1", reason: "too-thin", briefingId: "evil" });
    expect(parsed()[0]).toMatchObject({ event: "drop", guid: "g1", briefingId: "b-1" });
  });

  it("never writes secret values or secret-named fields", () => {
    const { log, parsed } = make(["sk-123"]);
    log.info("call", { message: "failed with key sk-123", apiKey: "sk-123", nested: { token: "x" } });
    const line = JSON.stringify(parsed()[0]);
    expect(line).not.toContain("sk-123");
    expect(parsed()[0]).toMatchObject({ apiKey: "[REDACTED]", nested: { token: "[REDACTED]" } });
  });
});
