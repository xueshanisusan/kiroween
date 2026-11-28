/**
 * MANUAL TOOL. Not part of the pipeline or the test suite; `npm test` never runs it.
 *
 * Speaks content/fixtures/voice-sample.txt once with Seed Audio through OpenRouter and writes
 * an MP3 to samples/ so candidate speaker ids can be compared by listening.
 * Needs a real OPENROUTER_API_KEY in the environment. OpenRouter bills per call
 * (about $0.15 per minute of audio). samples/ is git-ignored; never commit audio.
 * The key and any response body are never printed. The SDK exposes no generation id.
 *
 * Usage: npx tsx scripts/synthesize-seed-sample.ts [voice-id]
 *        npx tsx scripts/synthesize-seed-sample.ts --voice <voice-id>
 * With no voice, the adapter's configured speaker id is used (empty means the API default).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { measureMp3DurationSeconds } from "../src/publish/duration.js";
import { createSeedAdapter } from "../src/tts/seed.js";

const SAMPLE_TEXT_FILE = "content/fixtures/voice-sample.txt";
const OUTPUT_DIR = "samples";

function parseVoice(argv: string[]): string | undefined {
  let voice: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--voice") {
      voice = argv[++i];
      if (voice === undefined || voice === "") throw new Error("--voice needs a speaker id");
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else voice = arg;
  }
  return voice;
}

async function main(): Promise<void> {
  const voice = parseVoice(process.argv.slice(2));
  if ((process.env.OPENROUTER_API_KEY ?? "").trim() === "") {
    throw new Error("OPENROUTER_API_KEY is not set. Export it in the environment first; this tool bills per call.");
  }
  const text = (await readFile(SAMPLE_TEXT_FILE, "utf8"))
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
  if (text === "") throw new Error(`${SAMPLE_TEXT_FILE} has no text to speak`);

  const adapter = createSeedAdapter({ env: process.env, ...(voice === undefined ? {} : { voice }) });
  // The second argument is the Piper voice id, which the Seed adapter ignores.
  const result = await adapter.synthesize(text, "", new AbortController().signal);
  if (!result.ok) {
    throw new Error(`synthesis failed: ${result.error.kind}: ${result.error.message} (attempts: ${result.error.attempts})`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const label = (voice ?? "default").replace(/[^A-Za-z0-9._-]/g, "_");
  const dest = path.join(OUTPUT_DIR, `seed-${label}.mp3`);
  await writeFile(dest, result.value);
  const duration = measureMp3DurationSeconds(result.value);
  console.log(
    `Wrote ${dest} (voice: ${voice ?? "configured default"}, ${duration.ok ? `${duration.value.toFixed(1)} s` : `duration unmeasurable: ${duration.error.message}`})`,
  );
}

main().catch((err: unknown) => {
  console.error(`synthesize-seed-sample: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
