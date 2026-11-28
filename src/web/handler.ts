import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WebConfig } from '../config/index.js';
import type { Logger } from '../lib/log.js';
import { episodeJson } from './routes/episode-json.js';
import { episodeMp3 } from './routes/episode-mp3.js';
import { healthz } from './routes/healthz.js';
import { methodNotAllowed } from './routes/method-not-allowed.js';
import { notFound } from './routes/not-found.js';
import { root } from './routes/root.js';
import { jsonResult, type RouteContext, type RouteResult } from './routes/route-types.js';

export type HandlerOptions = {
  dataDir: string;
  config: WebConfig;
  logger: Logger;
  /** Clock for request duration, in milliseconds. Defaults to Date.now. */
  now?: () => number;
};

type RouteFn = (ctx: RouteContext) => RouteResult | Promise<RouteResult>;

/** Fixed route table. The request URL is only ever compared to these keys, never used as a file path. */
const ROUTES: ReadonlyMap<string, RouteFn> = new Map<string, RouteFn>([
  ['/', root],
  ['/episode.json', episodeJson],
  ['/episode.mp3', episodeMp3],
  ['/healthz', healthz],
]);

function pathnameOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? '/', 'http://x').pathname;
  } catch {
    return null;
  }
}

function bodyLength(body: Buffer | string): number {
  return typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length;
}

export function createRequestHandler(
  options: HandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const now = options.now ?? Date.now;
  const { logger } = options;

  return (req, res) => {
    const requestId = randomUUID();
    const startedAt = now();
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = pathnameOf(req.url);
    const routeFn = pathname === null ? undefined : ROUTES.get(pathname);
    const route = routeFn !== undefined && pathname !== null ? pathname : 'other';

    let bytesSent = 0;
    let status = 0;
    let rangeFields: { rangeStart?: number; rangeEnd?: number } = {};
    let logged = false;

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    const writeLog = (): void => {
      if (logged) return;
      logged = true;
      logger.info('request', {
        route,
        method,
        status: status || res.statusCode,
        durationMs: now() - startedAt,
        bytesSent,
        requestId,
        ...rangeFields,
      });
    };
    res.on('finish', writeLog);
    // Client went away before finish: still record the request once.
    res.on('close', writeLog);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const run = async (): Promise<RouteResult> => {
      const ctx: RouteContext = {
        method,
        headers: req.headers,
        dataDir: options.dataDir,
        config: options.config,
        signal: abort.signal,
      };
      if (routeFn === undefined) return notFound(ctx);
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();
      return routeFn(ctx);
    };

    void (async () => {
      let result: RouteResult;
      try {
        result = await run();
      } catch (err) {
        logger.info('request-error', {
          route,
          requestId,
          errorName: err instanceof Error ? err.name : 'unknown',
          errorMessage: err instanceof Error ? err.message : 'non-error thrown',
        });
        result = jsonResult(500, { error: 'internal-error' }, {}, method === 'HEAD');
      }

      if (result.loadError) {
        const { kind, field } = result.loadError;
        logger.info('episode-load-error', {
          route,
          requestId,
          kind,
          ...(field !== undefined ? { field } : {}),
        });
      }
      rangeFields = {
        ...(result.rangeStart !== undefined ? { rangeStart: result.rangeStart } : {}),
        ...(result.rangeEnd !== undefined ? { rangeEnd: result.rangeEnd } : {}),
      };

      status = result.status;
      try {
        res.writeHead(result.status, result.headers);
        const body = result.body;
        if (body === null) {
          res.end();
        } else if (body instanceof Readable) {
          const counter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              bytesSent += chunk.length;
              cb(null, chunk);
            },
          });
          try {
            await pipeline(body, counter, res);
          } catch {
            // Client abort or stream failure: pipeline already destroyed both ends.
            if (!res.writableEnded) res.destroy();
          }
        } else {
          bytesSent += bodyLength(body);
          res.end(body);
        }
      } catch (err) {
        logger.info('response-error', {
          route,
          requestId,
          errorName: err instanceof Error ? err.name : 'unknown',
        });
        res.destroy();
      }
    })();
  };
}
