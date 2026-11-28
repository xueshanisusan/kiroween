import type { EpisodeJson } from "../publish/episode-json.js";

export type RenderInput = { kind: "published"; episode: EpisodeJson } | { kind: "empty" };

export type PageText = {
  outletName: string;
  pageTitle: string;
  emptyStateMessage: string;
  audioLabel: string;
};

/** Escapes & < > " ' so a string is safe in element text and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPublished(episode: EpisodeJson, text: PageText): string {
  const audio =
    `<audio controls preload="metadata" aria-label="${escapeHtml(text.audioLabel)}" src="/episode.mp3">` +
    `<a href="/episode.mp3">${escapeHtml(text.audioLabel)}</a></audio>`;
  const facts = `<p>${escapeHtml(text.outletName)}, ${escapeHtml(episode.generatedFor)}</p>`;
  const stories = episode.stories
    .map((s) => `<h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(s.script)}</p>`)
    .join("");
  return audio + facts + stories;
}

export function renderPage(input: RenderInput, text: PageText): string {
  const body =
    input.kind === "published"
      ? renderPublished(input.episode, text)
      : `<p>${escapeHtml(text.emptyStateMessage)}</p>`;
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(text.pageTitle)}</title></head><body>` +
    `<h1>${escapeHtml(text.outletName)}</h1><main>${body}</main></body></html>`
  );
}
