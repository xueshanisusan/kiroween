// Vitest setup file: any real network attempt fails the test (Requirements 14.2, 14.5, 14.6).
// The one exception is loopback (127.0.0.1), so tests can talk to a local server they started.
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class NetworkDisabledError extends Error {
  constructor(what: string) {
    super(`Network access is disabled in tests: ${what}`);
    this.name = "NetworkDisabledError";
  }
}

function blocked(what: string): never {
  throw new NetworkDisabledError(what);
}

const LOOPBACK_HOST = "127.0.0.1";

function hostOfOptions(o: unknown): string | undefined {
  if (o === null || typeof o !== "object") return undefined;
  const r = o as { hostname?: unknown; host?: unknown };
  if (typeof r.hostname === "string") return r.hostname;
  if (typeof r.host === "string") return r.host;
  return undefined;
}

/** Host of an http/https request's first arguments (URL string, URL object or options). */
function httpHost(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "string") {
    try {
      return new URL(first).hostname;
    } catch {
      return undefined;
    }
  }
  if (first instanceof URL) return first.hostname;
  return hostOfOptions(first);
}

/** Host of net.connect style arguments: (port, host?), (options) or (path). */
function netHost(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "number") return typeof args[1] === "string" ? args[1] : undefined;
  if (Array.isArray(first)) return netHost(first);
  return hostOfOptions(first);
}

const g = globalThis as { fetch: unknown };
const originalFetch = globalThis.fetch;
g.fetch = async (...args: unknown[]) => {
  const input = args[0];
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : undefined;
  if (url !== undefined) {
    try {
      if (new URL(url).hostname === LOOPBACK_HOST) {
        return (originalFetch as (...a: unknown[]) => Promise<Response>)(...args);
      }
    } catch {
      // fall through to blocked
    }
  }
  blocked(`fetch(${typeof input === "string" ? input : String(input)})`);
};

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;

const patch = (
  target: object,
  names: string[],
  label: string,
  hostOf: (args: unknown[]) => string | undefined,
): void => {
  for (const name of names) {
    const original = (target as Record<string, AnyFn>)[name] as AnyFn;
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: function (this: unknown, ...args: unknown[]) {
        if (hostOf(args) === LOOPBACK_HOST) return original.apply(this, args);
        return blocked(`${label}.${name}`);
      },
    });
  }
};

patch(http, ["request", "get"], "http", httpHost);
patch(https, ["request", "get"], "https", httpHost);
patch(net, ["connect", "createConnection"], "net", netHost);
// Low-level guard: every socket-based client (http, https, tls, undici) ends up here.
patch(net.Socket.prototype, ["connect"], "net.Socket", netHost);
