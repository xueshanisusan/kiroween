import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import type { WebConfig } from '../../config/index.js';

/** Episode load problem reported to the handler for logging (kind and field name only, never the message). */
export type RouteLoadError = { kind: string; field?: string };

export type RouteResult = {
  status: number;
  headers: Record<string, string>;
  /** null for HEAD, 304 and 416. */
  body: Buffer | string | Readable | null;
  /** First byte served for a 206 (inclusive), for logging. */
  rangeStart?: number;
  /** Last byte served for a 206 (inclusive), for logging. */
  rangeEnd?: number;
  /** Set when the episode loader failed, for logging. */
  loadError?: RouteLoadError;
};

export type RouteContext = {
  /** Upper-case HTTP method, e.g. GET or HEAD. */
  method: string;
  headers: IncomingHttpHeaders;
  dataDir: string;
  config: WebConfig;
  /** Set when the client aborts; routes streaming a body should stop. */
  signal?: AbortSignal;
};

/** Build a JSON response with Content-Type and Content-Length set. */
export function jsonResult(
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {},
  omitBody = false,
): RouteResult {
  const text = JSON.stringify(value);
  return {
    status,
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text, 'utf8')),
    },
    body: omitBody ? null : text,
  };
}
