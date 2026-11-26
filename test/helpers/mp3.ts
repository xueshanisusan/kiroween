/**
 * Deterministic test MP3 builder. Frames carry real MPEG audio frame headers
 * (zeroed payload), so a header parser sees valid, contiguous frames.
 * The default format comes from ASSUMED_TTS_AUDIO_FORMAT.
 */
import { ASSUMED_TTS_AUDIO_FORMAT } from "../../src/config/tts-format.js";

export type MpegVersion = "MPEG-1" | "MPEG-2";

export interface Mp3Format {
  mpegVersion: MpegVersion;
  sampleRateHz: number;
  channels: 1 | 2;
  bitrateKbps: number;
}

/** Format of the default fake TTS output, taken from the assumed TTS format. */
export const DEFAULT_MP3_FORMAT: Mp3Format = {
  mpegVersion: ASSUMED_TTS_AUDIO_FORMAT.mpegVersion,
  sampleRateHz: ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz,
  channels: ASSUMED_TTS_AUDIO_FORMAT.channels,
  bitrateKbps: ASSUMED_TTS_AUDIO_FORMAT.fakeBitrateKbps,
};

/** (h) MPEG-1 Layer III 44.1 kHz stereo. */
export const MPEG1_44K_STEREO: Mp3Format = {
  mpegVersion: "MPEG-1",
  sampleRateHz: 44100,
  channels: 2,
  bitrateKbps: 128,
};

/** (i) MPEG-2 Layer III 22.05 kHz mono. */
export const MPEG2_22K_MONO: Mp3Format = {
  mpegVersion: "MPEG-2",
  sampleRateHz: 22050,
  channels: 1,
  bitrateKbps: 32,
};

const BITRATES: Record<MpegVersion, readonly number[]> = {
  "MPEG-1": [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "MPEG-2": [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<MpegVersion, readonly number[]> = {
  "MPEG-1": [44100, 48000, 32000],
  "MPEG-2": [22050, 24000, 16000],
};

export function samplesPerFrame(version: MpegVersion): number {
  return version === "MPEG-1" ? 1152 : 576;
}

/** Frame length without padding: floor(coef*kbps/rate), coef 144000 (MPEG-1) or 72000 (MPEG-2). */
export function frameLength(
  version: MpegVersion,
  kbps: number,
  rate: number,
  padding: 0 | 1,
): number {
  const coef = version === "MPEG-1" ? 144000 : 72000;
  return Math.floor((coef * kbps) / rate) + padding;
}

/** Encode one 4-byte header. */
function header(f: Mp3Format, kbps: number, padding: 0 | 1): Buffer {
  const brIdx = BITRATES[f.mpegVersion].indexOf(kbps);
  const srIdx = SAMPLE_RATES[f.mpegVersion].indexOf(f.sampleRateHz);
  if (brIdx < 0) throw new Error(`Unsupported bitrate ${kbps} for ${f.mpegVersion}`);
  if (srIdx < 0) throw new Error(`Unsupported sample rate ${f.sampleRateHz} for ${f.mpegVersion}`);
  const versionBits = f.mpegVersion === "MPEG-1" ? 0b11 : 0b10;
  const layerBits = 0b01; // Layer III
  const b1 = 0xe0 | (versionBits << 3) | (layerBits << 1) | 1; // 1 = no CRC
  const b2 = ((brIdx + 1) << 4) | (srIdx << 2) | (padding << 1);
  const b3 = (f.channels === 1 ? 0b11 : 0b00) << 6; // 11 = single channel, 00 = stereo
  return Buffer.from([0xff, b1, b2, b3]);
}

export interface Frames {
  bytes: Buffer;
  frameCount: number;
  /** Exact duration of all frames, in seconds. */
  durationSeconds: number;
  /** Byte lengths of each frame, in order. */
  frameLengths: number[];
}

/**
 * Build contiguous frames. `bitratePattern` (optional) gives the per-frame bitrate
 * cycle for VBR; otherwise every frame uses `format.bitrateKbps`.
 * Padding bits follow the usual accumulator so average bitrate stays exact.
 */
export function buildFrames(
  format: Mp3Format,
  frameCount: number,
  bitratePattern?: readonly number[],
): Frames {
  const parts: Buffer[] = [];
  const lengths: number[] = [];
  let sampleTotal = 0;
  let remainder = 0; // fractional bytes carried for the padding decision
  for (let i = 0; i < frameCount; i++) {
    const kbps = bitratePattern ? bitratePattern[i % bitratePattern.length]! : format.bitrateKbps;
    const coef = format.mpegVersion === "MPEG-1" ? 144000 : 72000;
    const frac = (coef * kbps) % format.sampleRateHz;
    remainder += frac;
    let padding: 0 | 1 = 0;
    if (remainder >= format.sampleRateHz) {
      remainder -= format.sampleRateHz;
      padding = 1;
    }
    const len = frameLength(format.mpegVersion, kbps, format.sampleRateHz, padding);
    const frame = Buffer.alloc(len); // zero payload: no accidental 0xFF sync bytes
    header(format, kbps, padding).copy(frame, 0);
    parts.push(frame);
    lengths.push(len);
    sampleTotal += samplesPerFrame(format.mpegVersion);
  }
  return {
    bytes: Buffer.concat(parts),
    frameCount,
    durationSeconds: sampleTotal / format.sampleRateHz,
    frameLengths: lengths,
  };
}

/** Number of frames covering at least `seconds` of audio. */
export function framesForSeconds(format: Mp3Format, seconds: number): number {
  return Math.ceil((seconds * format.sampleRateHz) / samplesPerFrame(format.mpegVersion));
}

function syncsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

/**
 * ID3v2.3 tag. Body holds a TXXX-style frame whose text contains 0xFF 0xFB false
 * syncs (with plausible header bytes after them), followed by zero padding.
 */
export function buildId3v2(paddingBytes = 256): Buffer {
  const falseSync = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0xff, 0xfb, 0x50, 0xc4]);
  const text = Buffer.concat([Buffer.from([0x00]), Buffer.from("test\0", "latin1"), falseSync]);
  const frameHeader = Buffer.alloc(10);
  frameHeader.write("TXXX", 0, "latin1");
  frameHeader.writeUInt32BE(text.length, 4); // ID3v2.3 frame sizes are plain big-endian
  const body = Buffer.concat([frameHeader, text, Buffer.alloc(paddingBytes)]);
  const tagHeader = Buffer.concat([
    Buffer.from("ID3", "latin1"),
    Buffer.from([0x03, 0x00, 0x00]),
    syncsafe(body.length),
  ]);
  return Buffer.concat([tagHeader, body]);
}

/** 128-byte ID3v1 trailer whose comment field contains 0xFF 0xFB. */
export function buildId3v1(): Buffer {
  const tag = Buffer.alloc(128);
  tag.write("TAG", 0, "latin1");
  tag.write("Test title", 3, "latin1");
  tag.write("Test artist", 33, "latin1");
  Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(tag, 97); // comment field
  return tag;
}

/** Deterministic non-sync garbage (no 0xFF bytes). */
export function buildGarbage(length = 200): Buffer {
  const b = Buffer.alloc(length);
  for (let i = 0; i < length; i++) b[i] = (i * 31 + 7) % 0xf0;
  return b;
}

export type Mp3Variant =
  | "bare" // (a)
  | "id3v2" // (b)
  | "id3v1" // (c)
  | "id3v2+id3v1" // (d) default fake TTS output
  | "truncated" // (e)
  | "trailing-garbage" // (f)
  | "vbr"; // (g)

export interface BuiltMp3 {
  bytes: Buffer;
  /** Duration of the complete frames only (a truncated final frame is not counted). */
  durationSeconds: number;
  /** Number of complete frames. */
  frameCount: number;
  /** Byte offset of the first frame. */
  firstFrameOffset: number;
  format: Mp3Format;
}

export interface BuildMp3Options {
  variant?: Mp3Variant;
  format?: Mp3Format;
  /** Target length; the frame count is rounded up. Default 35 seconds. */
  seconds?: number;
  /** Explicit frame count, overrides `seconds`. */
  frames?: number;
}

/** Default VBR bitrates for MPEG-2 and MPEG-1 formats. */
const VBR_PATTERNS: Record<MpegVersion, readonly number[]> = {
  "MPEG-2": [24, 32, 48, 64, 40, 56],
  "MPEG-1": [64, 96, 128, 192, 112, 160],
};

export function buildMp3(opts: BuildMp3Options = {}): BuiltMp3 {
  const variant = opts.variant ?? "id3v2+id3v1";
  const format = opts.format ?? DEFAULT_MP3_FORMAT;
  const count = opts.frames ?? framesForSeconds(format, opts.seconds ?? 35);
  const frames = buildFrames(
    format,
    count,
    variant === "vbr" ? VBR_PATTERNS[format.mpegVersion] : undefined,
  );

  let audio = frames.bytes;
  let frameCount = frames.frameCount;
  let durationSeconds = frames.durationSeconds;
  if (variant === "truncated") {
    const lastLen = frames.frameLengths[frames.frameLengths.length - 1]!;
    audio = audio.subarray(0, audio.length - Math.floor(lastLen / 2));
    frameCount -= 1;
    durationSeconds = (frameCount * samplesPerFrame(format.mpegVersion)) / format.sampleRateHz;
  }

  const head = variant === "id3v2" || variant === "id3v2+id3v1" ? buildId3v2() : Buffer.alloc(0);
  const tail =
    variant === "id3v1" || variant === "id3v2+id3v1"
      ? buildId3v1()
      : variant === "trailing-garbage"
        ? buildGarbage()
        : Buffer.alloc(0);

  return {
    bytes: Buffer.concat([head, audio, tail]),
    durationSeconds,
    frameCount,
    firstFrameOffset: head.length,
    format,
  };
}

/** The default fake TTS output: variant (d), about 35 seconds, from ASSUMED_TTS_AUDIO_FORMAT. */
export function buildDefaultFakeTtsMp3(seconds = 35): BuiltMp3 {
  return buildMp3({ variant: "id3v2+id3v1", seconds });
}
