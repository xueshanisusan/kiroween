/**
 * MANUAL TOOL. Not part of the pipeline; no test reads its output.
 *
 * Downloads a Piper voice (<voice-id>.onnx and <voice-id>.onnx.json) from the
 * rhasspy/piper-voices repository on Hugging Face into models/piper/.
 * Existing files are skipped. models/ is git-ignored; never commit a model.
 *
 * Usage: npx tsx scripts/fetch-voice.ts en_US-ryan-high
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { PIPER_VOICE_MODEL_DIR, PIPER_VOICES_BASE_URL, VOICE_DOWNLOAD_TIMEOUT_MS } from "../src/config/index.js";

/** Repository directory for a voice id like en_US-ryan-high: en/en_US/ryan/high. */
export function voiceRepoPath(voiceId: string): string | undefined {
  const match = /^([a-z]{2,3})_([A-Z]{2})-([A-Za-z0-9_]+)-([a-z_]+)$/.exec(voiceId);
  if (!match) return undefined;
  const [, language, region, name, quality] = match;
  return `${language}/${language}_${region}/${name}/${quality}`;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then((s) => s.size > 0, () => false);
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(VOICE_DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || res.body === null) throw new Error(`GET ${url} failed: HTTP ${res.status} ${res.statusText}`);
  const expected = Number(res.headers.get("content-length") ?? "");
  const partial = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(partial));
    const size = (await stat(partial)).size;
    if (size === 0) throw new Error(`download of ${url} was empty`);
    if (Number.isFinite(expected) && expected > 0 && size !== expected) {
      throw new Error(`download of ${url} incomplete: got ${size} bytes, expected ${expected}`);
    }
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
}

async function main(): Promise<void> {
  const voiceId = process.argv[2];
  if (voiceId === undefined) throw new Error("usage: npx tsx scripts/fetch-voice.ts <voice-id>");
  const repoPath = voiceRepoPath(voiceId);
  if (repoPath === undefined) throw new Error(`cannot parse voice id "${voiceId}" (expected e.g. en_US-ryan-high)`);

  await mkdir(PIPER_VOICE_MODEL_DIR, { recursive: true });
  for (const file of [`${voiceId}.onnx`, `${voiceId}.onnx.json`]) {
    const dest = path.join(PIPER_VOICE_MODEL_DIR, file);
    if (await exists(dest)) {
      console.log(`skip ${dest} (exists)`);
      continue;
    }
    await download(`${PIPER_VOICES_BASE_URL}/${repoPath}/${file}`, dest);
    console.log(`downloaded ${dest} (${(await stat(dest)).size} bytes)`);
  }
}

main().catch((err: unknown) => {
  console.error(`fetch-voice: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
