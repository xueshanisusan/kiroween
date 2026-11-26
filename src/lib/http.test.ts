import { describe, expect, it } from "vitest";
import { createHttpClient, httpGet, type FetchLike } from "./http.js";

const res = (status: number, text = "") => ({ status, text: async () => text });

describe("createHttpClient (fake fetch)", () => {
  it("returns the body on 200", async () => {
    const c = createHttpClient({ fetchImpl: async () => res(200, "hi") });
    expect(await httpGet(c, "http://x")).toEqual({ ok: true, value: { status: 200, body: "hi" } });
  });

  it("retries once on 5xx then succeeds", async () => {
    let calls = 0;
    const f: FetchLike = async () => (++calls === 1 ? res(503) : res(200, "ok"));
    const r = await httpGet(createHttpClient({ fetchImpl: f, retries: 1 }), "http://x");
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("returns a typed status error after retries are exhausted", async () => {
    let calls = 0;
    const f: FetchLike = async () => (calls++, res(500));
    const r = await httpGet(createHttpClient({ fetchImpl: f, retries: 1 }), "http://x");
    expect(r).toMatchObject({ ok: false, error: { kind: "status", status: 500, attempts: 2 } });
    expect(calls).toBe(2);
  });

  it("does not retry 4xx", async () => {
    let calls = 0;
    const f: FetchLike = async () => (calls++, res(404));
    await httpGet(createHttpClient({ fetchImpl: f, retries: 1 }), "http://x");
    expect(calls).toBe(1);
  });

  it("times out a hung request", async () => {
    const f: FetchLike = (_u, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("abort"))));
    const r = await httpGet(createHttpClient({ fetchImpl: f, retries: 0 }), "http://x", { timeoutMs: 10 });
    expect(r).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("stops without retrying when the caller aborts", async () => {
    let calls = 0;
    const ac = new AbortController();
    const f: FetchLike = (_u, init) =>
      new Promise((_, reject) => {
        calls++;
        init.signal.addEventListener("abort", () => reject(new Error("abort")));
        ac.abort();
      });
    const r = await httpGet(createHttpClient({ fetchImpl: f, retries: 1 }), "http://x", { signal: ac.signal });
    expect(r).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(calls).toBe(1);
  });
});
