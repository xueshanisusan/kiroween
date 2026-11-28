import { describe, expect, it } from "vitest";
import { WEB_CONFIG } from "../config/index.js";
import type { EpisodeJson } from "../publish/episode-json.js";
import { renderPage } from "./render.js";

const TEXT = {
  outletName: WEB_CONFIG.outletName,
  pageTitle: WEB_CONFIG.pageTitle,
  emptyStateMessage: WEB_CONFIG.emptyStateMessage,
  audioLabel: WEB_CONFIG.audioLabel,
};

const EPISODE: EpisodeJson = {
  generatedFor: "2026-11-24",
  selectedItemIds: ["a", "b"],
  stories: [
    { guid: "a", title: "First story", script: "First script body." },
    { guid: "b", title: "Second story", script: "Second script body." },
  ],
};

const published = (episode: EpisodeJson = EPISODE): string =>
  renderPage({ kind: "published", episode }, TEXT);

describe("renderPage published", () => {
  it("renders a <script>alert(1)</script> script body as escaped text, not an element (14.5)", () => {
    const html = published({
      ...EPISODE,
      stories: [{ guid: "x", title: "T", script: "<script>alert(1)</script>" }],
    });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("puts the audio element before the transcript, both inside <main> (2.1, 2.3)", () => {
    const html = published();
    const mainStart = html.indexOf("<main>");
    const mainEnd = html.indexOf("</main>");
    const audio = html.indexOf("<audio");
    const transcript = html.indexOf("<h2>");
    expect(mainStart).toBeGreaterThanOrEqual(0);
    expect(audio).toBeGreaterThan(mainStart);
    expect(transcript).toBeGreaterThan(audio);
    expect(html.indexOf("</audio>")).toBeLessThan(transcript);
    expect(transcript).toBeLessThan(mainEnd);
    expect(html.lastIndexOf("</p>")).toBeLessThan(mainEnd);
  });

  it('sets preload="metadata" and lang="en" (2.4, 1.3)', () => {
    const html = published();
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('<html lang="en"');
  });

  it("puts a fallback link to the MP3 inside <audio> (2.9)", () => {
    const html = published();
    const open = html.indexOf("<audio");
    const close = html.indexOf("</audio>");
    const link = html.indexOf('<a href="/episode.mp3"');
    expect(link).toBeGreaterThan(open);
    expect(link).toBeLessThan(close);
  });

  it("has no external resource, <style>, <script or tabindex (1.4, 1.5, 1.6, 2.10)", () => {
    const html = published();
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("tabindex");
  });
});

describe("renderPage empty", () => {
  it("contains the Empty_State_Message and no <audio> (3.1)", () => {
    const html = renderPage({ kind: "empty" }, TEXT);
    expect(html).toContain(WEB_CONFIG.emptyStateMessage);
    expect(html).not.toContain("<audio");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
  });
});
