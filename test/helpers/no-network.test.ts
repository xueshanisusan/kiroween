import http from "node:http";
import https from "node:https";
import net from "node:net";
import { describe, expect, it } from "vitest";

describe("network-disabling harness", () => {
  it("makes global fetch fail", async () => {
    await expect(fetch("http://example.com/")).rejects.toThrow(/Network access is disabled/);
  });

  it("makes http, https and net attempts fail", () => {
    expect(() => http.get("http://example.com/")).toThrow(/Network access is disabled/);
    expect(() => https.request("https://example.com/")).toThrow(/Network access is disabled/);
    expect(() => net.connect(80, "example.com")).toThrow(/Network access is disabled/);
  });
});
