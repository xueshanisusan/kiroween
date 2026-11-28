import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BRIEFING_DEFAULT_DATA_DIR,
  WEB_CONFIG,
  WEB_DEFAULT_HOST,
  WEB_DEFAULT_PORT,
} from '../config/index.js';
import { createLogger, type Logger } from '../lib/log.js';
import { loadEpisode } from './episode-loader.js';
import { createRequestHandler } from './handler.js';

export type StartServerOptions = {
  /** Environment to read PORT, HOST and BRIEFING_DATA_DIR from. Defaults to process.env. */
  env?: Readonly<Record<string, string | undefined>>;
  logger?: Logger;
  /** Called for a fatal startup error. Defaults to process.exit. */
  exit?: (code: number) => never;
  /** Register SIGTERM/SIGINT handlers. Defaults to true. */
  handleSignals?: boolean;
};

function parsePort(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return WEB_DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback;
}

/** Starts the web service. Needs no credentials; a missing Data_Dir does not stop startup. */
export function startServer(options: StartServerOptions = {}): Server | null {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createLogger();
  const exit = options.exit ?? ((code: number): never => process.exit(code));

  const port = parsePort(env['PORT']);
  if (port === null) {
    // Name only: the value is never logged.
    logger.info('invalid-config', { variable: 'PORT' });
    exit(1);
    return null;
  }
  const host = nonEmpty(env['HOST'], WEB_DEFAULT_HOST);
  const dataDir = resolve(nonEmpty(env['BRIEFING_DATA_DIR'], BRIEFING_DEFAULT_DATA_DIR));

  const server = createServer(createRequestHandler({ dataDir, config: WEB_CONFIG, logger }));
  server.headersTimeout = WEB_CONFIG.headerTimeoutMs;
  server.timeout = WEB_CONFIG.idleTimeoutMs;

  server.listen(port, host, () => {
    logger.info('web-server-started', { port, host, dataDir });
    logger.info('episode-status', { episodeAvailable: loadEpisode(dataDir).ok });
  });

  if (options.handleSignals !== false) {
    const shutdown = (): void => {
      server.close(() => exit(0));
      server.closeIdleConnections();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
  return server;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  startServer();
}
