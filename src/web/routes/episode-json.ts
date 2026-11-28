import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EPISODE_JSON_FILE } from '../../publish/publish.js';
import { loadEpisode } from '../episode-loader.js';
import { etagOfBytes, matchesIfNoneMatch } from './etag.js';
import { jsonResult, type RouteContext, type RouteResult } from './route-types.js';

function noEpisode(ctx: RouteContext, loadError?: RouteResult['loadError']): RouteResult {
  const result = jsonResult(404, { error: 'no-episode' }, {}, ctx.method === 'HEAD');
  if (loadError !== undefined) result.loadError = loadError;
  return result;
}

/** Serves the published episode.json bytes exactly as stored on disk. */
export function episodeJson(ctx: RouteContext): RouteResult {
  const loaded = loadEpisode(ctx.dataDir);
  if (!loaded.ok) {
    const error = loaded.error;
    return noEpisode(
      ctx,
      error.kind === 'invalid-field' ? { kind: error.kind, field: error.field } : { kind: error.kind },
    );
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(join(ctx.dataDir, EPISODE_JSON_FILE));
  } catch {
    return noEpisode(ctx, { kind: 'no-episode' });
  }

  const etag = etagOfBytes(bytes);
  const headers: Record<string, string> = {
    'Cache-Control': `max-age=${ctx.config.jsonCacheMaxAgeSeconds}`,
    ETag: etag,
  };

  if (matchesIfNoneMatch(ctx.headers['if-none-match'], etag)) {
    return { status: 304, headers, body: null };
  }

  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(bytes.length);
  return { status: 200, headers, body: ctx.method === 'HEAD' ? null : bytes };
}
