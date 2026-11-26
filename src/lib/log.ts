import { randomUUID } from "node:crypto";

export type Stage = "ingest" | "select" | "summarize" | "ground" | "tts" | "publish";

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly briefingId: string;
  /** Free-form event line (skips, drops, lock events, build end). */
  info(event: string, fields?: LogFields): void;
  /** One line when a stage finishes: stage, outcome "ok", elapsed ms. */
  stageOk(stage: Stage, elapsedMs: number, fields?: LogFields): void;
  /** One line when a stage fails: stage, outcome "failed", elapsed ms, typed error code. */
  stageFailed(stage: Stage, elapsedMs: number, errorCode: string, fields?: LogFields): void;
}

export type LoggerOptions = {
  briefingId?: string;
  /** Line sink. Defaults to stdout. */
  write?: (line: string) => void;
  /** Secret values (API keys) to redact from every line. */
  secrets?: readonly string[];
};

const SECRET_KEY_RE = /(api[-_]?key|secret|token|password|authorization|credential)/i;
const REDACTED = "[REDACTED]";

function redactValue(value: unknown, secrets: readonly string[], depth: number): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const secret of secrets) if (secret.length > 0) s = s.split(secret).join(REDACTED);
    return s;
  }
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redactValue(v, secrets, depth + 1);
  }
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const briefingId = options.briefingId ?? randomUUID();
  const write = options.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const secrets = options.secrets ?? [];

  function emit(line: LogFields): void {
    // briefingId is set last so caller fields can never override it.
    const safe = redactValue({ ...line, briefingId }, secrets, 0) as LogFields;
    write(JSON.stringify(safe));
  }

  return {
    briefingId,
    info(event, fields = {}) {
      emit({ ...fields, event });
    },
    stageOk(stage, elapsedMs, fields = {}) {
      emit({ ...fields, stage, outcome: "ok", elapsedMs });
    },
    stageFailed(stage, elapsedMs, errorCode, fields = {}) {
      emit({ ...fields, stage, outcome: "failed", elapsedMs, errorCode });
    },
  };
}
