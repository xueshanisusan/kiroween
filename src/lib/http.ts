import { HTTP_RETRY_COUNT } from "../config/index.js";
import type { Result } from "../types.js";

/** Default per-attempt timeout for an outbound HTTP call (milliseconds). */
export const HTTP_TIMEOUT_MS = 15_000;

export type HttpErrorKind = "timeout" | "network" | "status" | "aborted";

export type HttpError = {
  kind: HttpErrorKind;
  message: string;
  /** Set when kind is "status". */
  status?: number;
  /** Number of attempts made (first try plus retries). */
  attempts: number;
};

export type HttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Per-attempt timeout in milliseconds. Defaults to HTTP_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Caller cancellation (for example the build deadline). Never retried once aborted. */
  signal?: AbortSignal;
};

export type HttpResponse = { status: number; body: string };

/** The only way pipeline code performs a network call. Tests pass fakes. */
export interface HttpClient {
  request(req: HttpRequest): Promise<Result<HttpResponse, HttpError>>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export type HttpClientOptions = {
  fetchImpl?: FetchLike;
  retries?: number;
};

/** Convenience GET. */
export function httpGet(
  client: HttpClient,
  url: string,
  opts: Omit<HttpRequest, "url" | "method"> = {},
): Promise<Result<HttpResponse, HttpError>> {
  return client.request({ ...opts, url, method: "GET" });
}

/**
 * Real client: timeout per attempt, `retries` retries (default HTTP_RETRY_COUNT) on
 * timeout, network failure and 5xx. 4xx responses and caller aborts are not retried.
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const retries = options.retries ?? HTTP_RETRY_COUNT;

  async function attempt(req: HttpRequest, attempts: number): Promise<Result<HttpResponse, HttpError>> {
    const timeoutMs = req.timeoutMs ?? HTTP_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    req.signal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const res = await fetchImpl(req.url, {
        method: req.method ?? "GET",
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      const body = await res.text();
      if (res.status >= 200 && res.status < 300) return { ok: true, value: { status: res.status, body } };
      return { ok: false, error: { kind: "status", status: res.status, message: `HTTP ${res.status}`, attempts } };
    } catch (e) {
      if (req.signal?.aborted) return { ok: false, error: { kind: "aborted", message: "aborted by caller", attempts } };
      if (timedOut) return { ok: false, error: { kind: "timeout", message: `timed out after ${timeoutMs} ms`, attempts } };
      return { ok: false, error: { kind: "network", message: e instanceof Error ? e.message : String(e), attempts } };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  return {
    async request(req) {
      if (req.signal?.aborted) return { ok: false, error: { kind: "aborted", message: "aborted by caller", attempts: 0 } };
      let result = await attempt(req, 1);
      for (let n = 1; n <= retries && !result.ok && isRetryable(result.error); n++) {
        if (req.signal?.aborted) return { ok: false, error: { kind: "aborted", message: "aborted by caller", attempts: n } };
        result = await attempt(req, n + 1);
      }
      return result;
    },
  };
}

function isRetryable(e: HttpError): boolean {
  if (e.kind === "timeout" || e.kind === "network") return true;
  return e.kind === "status" && (e.status ?? 0) >= 500;
}
