import type { Result } from "../types.js";

export type DurationError = { kind: "unmeasurable"; message: string };

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<"v1" | "v2" | "v25", number[]> = {
  v1: [44100, 48000, 32000],
  v2: [22050, 24000, 16000],
  v25: [11025, 12000, 8000],
};

type Header = { frameLength: number; seconds: number };
type HeaderParse = { ok: true; header: Header } | { ok: false; reason: string };

function parseHeader(buf: Buffer, offset: number): HeaderParse {
  if (offset + 4 > buf.length) return { ok: false, reason: "truncated header" };
  const b1 = buf[offset]!;
  const b2 = buf[offset + 1]!;
  const b3 = buf[offset + 2]!;
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return { ok: false, reason: "no frame sync" };
  const versionBits = (b2 >> 3) & 3;
  const layerBits = (b2 >> 1) & 3;
  if (versionBits === 1) return { ok: false, reason: "reserved MPEG version" };
  if (layerBits === 0) return { ok: false, reason: "reserved layer" };
  if (layerBits !== 1) return { ok: false, reason: "unsupported layer (only Layer III)" };
  const brIndex = b3 >> 4;
  if (brIndex === 0) return { ok: false, reason: "free-format bitrate" };
  if (brIndex === 15) return { ok: false, reason: "reserved bitrate index" };
  const srIndex = (b3 >> 2) & 3;
  if (srIndex === 3) return { ok: false, reason: "reserved sample rate index" };
  const padding = (b3 >> 1) & 1;
  const isV1 = versionBits === 3;
  const family = isV1 ? "v1" : versionBits === 2 ? "v2" : "v25";
  const bitrate = (isV1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[brIndex]!;
  const sampleRate = SAMPLE_RATES[family][srIndex]!;
  const samples = isV1 ? 1152 : 576;
  const frameLength = Math.floor(((isV1 ? 144000 : 72000) * bitrate) / sampleRate) + padding;
  return { ok: true, header: { frameLength, seconds: samples / sampleRate } };
}

function unmeasurable(message: string): Result<number, DurationError> {
  return { ok: false, error: { kind: "unmeasurable", message } };
}

/** Measures Layer III MP3 duration by walking frame headers. Errs toward underestimating. */
export function measureMp3DurationSeconds(mp3: Buffer): Result<number, DurationError> {
  if (mp3.length === 0) return unmeasurable("empty buffer");

  // (b) ID3v1 trailer
  let end = mp3.length;
  if (mp3.length >= 128 && mp3.toString("latin1", mp3.length - 128, mp3.length - 125) === "TAG") {
    end = mp3.length - 128;
  }

  // (a) ID3v2 tags, possibly stacked
  let pos = 0;
  while (pos + 3 <= mp3.length && mp3.toString("latin1", pos, pos + 3) === "ID3") {
    if (pos + 10 > mp3.length) return unmeasurable("truncated ID3v2 header");
    const sizeBytes = [mp3[pos + 6]!, mp3[pos + 7]!, mp3[pos + 8]!, mp3[pos + 9]!];
    if (sizeBytes.some((b) => b >= 0x80)) return unmeasurable("invalid ID3v2 syncsafe size");
    const size = (sizeBytes[0]! << 21) | (sizeBytes[1]! << 14) | (sizeBytes[2]! << 7) | sizeBytes[3]!;
    const footer = (mp3[pos + 5]! & 0x10) !== 0 ? 10 : 0;
    const tagLength = 10 + size + footer;
    if (pos + tagLength > mp3.length) return unmeasurable("ID3v2 tag exceeds buffer");
    pos += tagLength;
  }

  // (c) skip zero padding only, then the first header must be valid
  while (pos < end && mp3[pos] === 0) pos++;
  if (pos >= end) return unmeasurable("no audio frames");
  const first = parseHeader(mp3, pos);
  if (!first.ok) return unmeasurable(`first frame invalid: ${first.reason}`);
  const firstEnd = pos + first.header.frameLength;
  if (firstEnd > end) return unmeasurable("first frame extends past frame region");
  if (firstEnd !== end && !parseHeader(mp3, firstEnd).ok) {
    return unmeasurable("first frame not confirmed by a following frame");
  }

  // (d) contiguous frames, no resync
  let total = 0;
  while (pos < end) {
    const h = parseHeader(mp3, pos);
    if (!h.ok) break;
    if (pos + h.header.frameLength > end) break;
    total += h.header.seconds;
    pos += h.header.frameLength;
  }
  return { ok: true, value: total };
}
