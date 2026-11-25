/**
 * MANUAL AUDIT TOOL. Not used by tests.
 *
 * Downloads a real snapshot of the MIT News RSS feed into
 * content/fixtures/mit-<YYYY-MM-DD>.xml so a human can inspect it locally.
 * No test imports, runs, or reads the file this script writes. The output is
 * git-ignored (content/fixtures/*.xml) and is never committed.
 *
 * Usage: npx tsx scripts/fetch-fixture.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FEED_URL = "https://news.mit.edu/rss/feed";

async function main(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "..", "content", "fixtures");
  const outFile = path.join(outDir, `mit-${date}.xml`);

  const res = await fetch(FEED_URL);
  if (!res.ok) {
    throw new Error(`GET ${FEED_URL} failed: HTTP ${res.status} ${res.statusText}`);
  }
  const body = await res.text();

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, body, "utf8");
  console.log(`Wrote ${body.length} chars to ${outFile}`);
}

main().catch((err: unknown) => {
  console.error(`fetch-fixture: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
