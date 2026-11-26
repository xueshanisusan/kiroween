// Vitest setup file: any real network attempt fails the test (Requirements 14.2, 14.5, 14.6).
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

const g = globalThis as { fetch: unknown };
g.fetch = async (...args: unknown[]) => {
  const input = args[0];
  blocked(`fetch(${typeof input === "string" ? input : String(input)})`);
};

const patch = (target: object, names: string[], label: string): void => {
  for (const name of names) {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: () => blocked(`${label}.${name}`),
    });
  }
};

patch(http, ["request", "get"], "http");
patch(https, ["request", "get"], "https");
patch(net, ["connect", "createConnection"], "net");
// Low-level guard: every socket-based client (http, https, tls, undici) ends up here.
patch(net.Socket.prototype, ["connect"], "net.Socket");
