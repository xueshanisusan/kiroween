import { loadEpisode } from '../episode-loader.js';
import { renderPage, type PageText, type RenderInput } from '../render.js';
import type { RouteContext, RouteLoadError, RouteResult } from './route-types.js';

/** GET/HEAD /: the Web_Player page. Load failures serve the empty page with 200. */
export function root(ctx: RouteContext): RouteResult {
  const loaded = loadEpisode(ctx.dataDir);
  let input: RenderInput;
  let loadError: RouteLoadError | undefined;
  if (loaded.ok) {
    input = { kind: 'published', episode: loaded.value.episode };
  } else {
    input = { kind: 'empty' };
    // Kind and field name only; the parse message is never reported.
    loadError =
      loaded.error.kind === 'invalid-field'
        ? { kind: loaded.error.kind, field: loaded.error.field }
        : { kind: loaded.error.kind };
  }

  const text: PageText = {
    outletName: ctx.config.outletName,
    pageTitle: ctx.config.pageTitle,
    emptyStateMessage: ctx.config.emptyStateMessage,
    audioLabel: ctx.config.audioLabel,
  };
  const html = renderPage(input, text);
  const result: RouteResult = {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html, 'utf8')),
    },
    body: ctx.method === 'HEAD' ? null : html,
  };
  if (loadError) result.loadError = loadError;
  return result;
}
