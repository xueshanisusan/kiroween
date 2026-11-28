/**
 * Starts the web request handler on 127.0.0.1 with an ephemeral port against a
 * temporary Data_Dir. Log lines are captured through an injected logger.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WEB_CONFIG, type WebConfig } from "../../src/config/index.js";
import { createLogger } from "../../src/lib/log.js";
import { type EpisodeJson, serializeEpisode } from "../../src/publish/episode-json.js";
import { EPISODE_JSON_FILE, EPISODE_MP3_FILE } from "../../src/publish/publish.js";
import { createRequestHandler } from "../../src/web/handler.js";
import { buildMp3 } from "./mp3.js";

export type WebTestServer = {
  /** e.g. http://127.0.0.1:54321 (no trailing slash). */
  baseUrl: string;
  dataDir: string;
  /** Parsed JSON log lines captured so far. */
  logLines: () => Record<string, unknown>[];
  /** Write (or replace) a published pair in the Data_Dir. Returns the MP3 bytes. */
  publish: (episode: EpisodeJson, mp3Seconds?: number) => Buffer;
  /** Remove both published files. */
  unpublish: () => void;
  close: () => Promise<void>;
};

export type WebTestServerOptions = {
  /** Publish this episode before starting. */
  episode?: EpisodeJson;
  config?: WebConfig;
};

export function sampleEpisode(generatedFor = "2026-11-24", title = "First story"): EpisodeJson {
  return {
    generatedFor,
    selectedItemIds: ["g1"],
    stories: [{ guid: "g1", title, script: `Script for ${title}.` }],
  };
}

export async function startWebTestServer(
  options: WebTestServerOptions = {},
): Promise<WebTestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), "web-server-"));
  mkdirSync(dataDir, { recursive: true });
  const lines: string[] = [];
  const logger = createLogger({ briefingId: "web-test", write: (l) => lines.push(l) });

  const publish = (episode: EpisodeJson, mp3Seconds = 2): Buffer => {
    const mp3 = buildMp3({ seconds: mp3Seconds }).bytes;
    writeFileSync(join(dataDir, EPISODE_JSON_FILE), serializeEpisode(episode));
    writeFileSync(join(dataDir, EPISODE_MP3_FILE), mp3);
    return mp3;
  };
  const unpublish = (): void => {
    rmSync(join(dataDir, EPISODE_JSON_FILE), { force: true });
    rmSync(join(dataDir, EPISODE_MP3_FILE), { force: true });
  };
  if (options.episode) publish(options.episode);

  const server = createServer(
    createRequestHandler({ dataDir, config: options.config ?? WEB_CONFIG, logger }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    logLines: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    publish,
    unpublish,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
