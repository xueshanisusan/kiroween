/**
 * MANUAL TOOL. Not part of the pipeline; no test reads its output.
 *
 * Speaks content/fixtures/voice-sample.txt with a Piper voice and writes an MP3
 * to samples/ using the same argument builders as the TTS adapter.
 * samples/ is git-ignored; never commit audio.
 *
 * Usage: npx tsx scripts/make-voice-samples.ts <voice-id> [--pause <seconds>] [--radio]
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FFMPEG_BINARY,
  PIPER_BINARY,
  PIPER_VOICE_MODEL_DIR,
  TTS_RADIO_FILTER,
  TTS_SENTENCE_SILENCE_SECONDS,
} from "../src/config/index.js";
import { measureMp3DurationSeconds } from "../src/publish/duration.js";
import { buildFfmpegArgs, buildPiperArgs, createSpawnRunner, type ProcessSpec } from "../src/tts/tts.js";

const SAMPLE_TEXT_FILE = "content/fixtures/voice-sample.txt";
const OUTPUT_DIR = "samples";
/** ffmpeg filter that leaves audio unchanged, used when --radio is not given. */
const NO_FILTER = "anull";

function parseArgs(argv: string[]): { voiceId: string; pause: number; radio: boolean } {
  let voiceId: string | undefined;
  let pause = TTS_SENTENCE_SILENCE_SECONDS;
  let radio = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--radio") radio = true;
    else if (arg === "--pause") {
      pause = Number(argv[++i]);
      if (!Number.isFinite(pause) || pause < 0) throw new Error("--pause needs a non-negative number of seconds");
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else voiceId = arg;
  }
  if (voiceId === undefined) {
    throw new Error("usage: npx tsx scripts/make-voice-samples.ts <voice-id> [--pause <seconds>] [--radio]");
  }
  return { voiceId, pause, radio };
}

async function run(spec: ProcessSpec): Promise<void> {
  const outcome = await createSpawnRunner().run(spec, new AbortController().signal);
  if (outcome.kind === "spawn-failed") throw new Error(`${spec.command} failed to start: ${outcome.message}`);
  if (outcome.kind === "exited" && outcome.code !== 0) {
    throw new Error(`${spec.command} exited with code ${outcome.code}: ${outcome.stderr.trim().slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  const { voiceId, pause, radio } = parseArgs(process.argv.slice(2));
  const text = (await readFile(SAMPLE_TEXT_FILE, "utf8"))
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
  if (text === "") throw new Error(`${SAMPLE_TEXT_FILE} has no text to speak`);

  const dir = await mkdtemp(path.join(tmpdir(), "voice-sample-"));
  try {
    const wav = path.join(dir, "sample.wav");
    const mp3 = path.join(dir, "sample.mp3");
    const model = path.join(PIPER_VOICE_MODEL_DIR, `${voiceId}.onnx`);
    await run({ command: PIPER_BINARY, args: buildPiperArgs(model, wav, pause), stdin: text });
    await run({ command: FFMPEG_BINARY, args: buildFfmpegArgs(wav, mp3, radio ? TTS_RADIO_FILTER : NO_FILTER) });

    const bytes = await readFile(mp3);
    await mkdir(OUTPUT_DIR, { recursive: true });
    const name = `${voiceId}-pause${pause}${radio ? "-radio" : ""}.mp3`;
    const dest = path.join(OUTPUT_DIR, name);
    await writeFile(dest, bytes);
    const duration = measureMp3DurationSeconds(bytes);
    console.log(
      `Wrote ${dest} (${duration.ok ? `${duration.value.toFixed(1)} s` : `duration unmeasurable: ${duration.error.message}`})`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(`make-voice-samples: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
