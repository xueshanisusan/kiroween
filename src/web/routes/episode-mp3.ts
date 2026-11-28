import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { EPISODE_MP3_FILE } from '../../publish/publish.js';
import { parseRange } from '../range.js';
import { fileEtag, matchesIfNoneMatch } from './etag.js';
import { jsonResult, type RouteContext, type RouteResult } from './route-types.js';

/**
 * GET/HEAD /episode.mp3. The size, mtime and stream all come from one opened
 * file handle; the file is streamed and never read whole into memory.
 */
export async function episodeMp3(ctx: RouteContext): Promise<RouteResult> {
  const isHead = ctx.method === 'HEAD';
  const noEpisode = (): RouteResult => jsonResult(404, { error: 'no-episode' }, {}, isHead);

  let handle;
  try {
    handle = await open(join(ctx.dataDir, EPISODE_MP3_FILE), 'r');
  } catch {
    return noEpisode();
  }

  let handed = false;
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size === 0) return noEpisode();
    const size = st.size;

    const etag = await fileEtag(join(ctx.dataDir, EPISODE_MP3_FILE), st.mtimeMs, size);
    const baseHeaders = { ETag: etag, 'Accept-Ranges': 'bytes' };

    if (matchesIfNoneMatch(headerValue(ctx.headers['if-none-match']), etag)) {
      return { status: 304, headers: baseHeaders, body: null };
    }

    const range = parseRange(headerValue(ctx.headers.range), size);

    if (range.kind === 'unsatisfiable') {
      return {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' },
        body: null,
      };
    }

    const start = range.kind === 'satisfiable' ? range.start : 0;
    const end = range.kind === 'satisfiable' ? range.end : size - 1;
    const headers: Record<string, string> = {
      ...baseHeaders,
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(end - start + 1),
    };
    if (range.kind === 'satisfiable') headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const status = range.kind === 'satisfiable' ? 206 : 200;
    const rangeFields = range.kind === 'satisfiable' ? { rangeStart: start, rangeEnd: end } : {};

    if (isHead) return { status, headers, body: null, ...rangeFields };

    const stream = handle.createReadStream({ start, end, autoClose: true });
    handed = true;
    const destroy = (): void => {
      if (!stream.destroyed) stream.destroy();
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) destroy();
      else ctx.signal.addEventListener('abort', destroy, { once: true });
      stream.once('close', () => ctx.signal?.removeEventListener('abort', destroy));
    }
    return { status, headers, body: stream, ...rangeFields };
  } finally {
    if (!handed) await handle.close().catch(() => undefined);
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
