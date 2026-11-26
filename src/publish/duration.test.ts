import { describe, expect, it } from "vitest";
import { ASSUMED_TTS_AUDIO_FORMAT } from "../config/tts-format.js";
import { MIN_EPISODE_SECONDS } from "../config/index.js";
import {
  MPEG1_44K_STEREO,
  MPEG2_22K_MONO,
  buildDefaultFakeTtsMp3,
  buildMp3,
  type Mp3Variant,
} from "../../test/helpers/mp3.js";
import { measureMp3DurationSeconds } from "./duration.js";

function measure(bytes: Buffer): number {
  const r = measureMp3DurationSeconds(bytes);
  if (!r.ok) throw new Error(`unmeasurable: ${r.error.message}`);
  return r.value;
}

describe("measureMp3DurationSeconds: variants", () => {
  const frames = 400;
  const expected = buildMp3({ variant: "bare", frames }).durationSeconds;

  it.each<Mp3Variant>(["bare", "id3v2", "id3v1", "id3v2+id3v1"])(
    "variant %s reports the known duration",
    (variant) => {
      const built = buildMp3({ variant, frames });
      expect(built.durationSeconds).toBeCloseTo(expected, 9);
      expect(measure(built.bytes)).toBeCloseTo(expected, 9);
    },
  );

  it("(e) does not count the truncated final frame", () => {
    const built = buildMp3({ variant: "truncated", frames });
    expect(built.frameCount).toBe(frames - 1);
    expect(measure(built.bytes)).toBeCloseTo(built.durationSeconds, 9);
    expect(measure(built.bytes)).toBeLessThan(expected);
  });

  it("(f) ignores trailing garbage", () => {
    const built = buildMp3({ variant: "trailing-garbage", frames });
    expect(measure(built.bytes)).toBeCloseTo(expected, 9);
  });

  it("(g) VBR sums per frame", () => {
    const built = buildMp3({ variant: "vbr", frames });
    expect(measure(built.bytes)).toBeCloseTo(built.durationSeconds, 9);
  });

  it("(h) MPEG-1 44.1 kHz stereo measures from its own headers", () => {
    const built = buildMp3({ variant: "id3v2+id3v1", format: MPEG1_44K_STEREO, frames });
    expect(built.durationSeconds).toBeCloseTo((frames * 1152) / 44100, 9);
    expect(measure(built.bytes)).toBeCloseTo(built.durationSeconds, 9);
  });

  it("(i) MPEG-2 22.05 kHz mono measures from its own headers", () => {
    const built = buildMp3({ variant: "id3v2+id3v1", format: MPEG2_22K_MONO, frames });
    expect(built.durationSeconds).toBeCloseTo((frames * 576) / 22050, 9);
    expect(measure(built.bytes)).toBeCloseTo(built.durationSeconds, 9);
  });
});

describe("default fake TTS MP3", () => {
  it("measures about 35 seconds, not about 70, and is below MIN_EPISODE_SECONDS", () => {
    const built = buildDefaultFakeTtsMp3();
    const d = measure(built.bytes);
    expect(d).toBeGreaterThanOrEqual(35);
    expect(d).toBeLessThan(36);
    expect(d).toBeLessThan(MIN_EPISODE_SECONDS);
  });

  it("first frame header matches ASSUMED_TTS_AUDIO_FORMAT", () => {
    const built = buildDefaultFakeTtsMp3();
    const o = built.firstFrameOffset;
    const b = built.bytes;
    expect(b[o]).toBe(0xff);
    expect(b[o + 1]! & 0xe0).toBe(0xe0);
    const versionBits = (b[o + 1]! >> 3) & 3;
    const layerBits = (b[o + 1]! >> 1) & 3;
    const srIndex = (b[o + 2]! >> 2) & 3;
    const channelMode = (b[o + 3]! >> 6) & 3;
    const version = versionBits === 3 ? "MPEG-1" : versionBits === 2 ? "MPEG-2" : "other";
    const rates = version === "MPEG-1" ? [44100, 48000, 32000] : [22050, 24000, 16000];
    expect(version).toBe(ASSUMED_TTS_AUDIO_FORMAT.mpegVersion);
    expect(4 - layerBits).toBe(ASSUMED_TTS_AUDIO_FORMAT.layer);
    expect(rates[srIndex]).toBe(ASSUMED_TTS_AUDIO_FORMAT.sampleRateHz);
    expect(channelMode === 3 ? 1 : 2).toBe(ASSUMED_TTS_AUDIO_FORMAT.channels);
  });
});

describe("measureMp3DurationSeconds: unmeasurable", () => {
  const withHeader = (h: number[]) => {
    const good = buildMp3({ variant: "bare", frames: 10 }).bytes;
    const b = Buffer.from(good);
    Buffer.from(h).copy(b, 0);
    return b;
  };
  // MPEG-2 L3 baseline header bytes: FF F3 (v2, L3), then bitrate/sr byte, then mode byte
  const cases: [string, number[]][] = [
    ["Layer II", [0xff, 0xf5, 0x84, 0xc0]],
    ["free-format bitrate", [0xff, 0xf3, 0x04, 0xc0]],
    ["reserved bitrate index", [0xff, 0xf3, 0xf4, 0xc0]],
    ["reserved sample rate", [0xff, 0xf3, 0x8c, 0xc0]],
    ["reserved layer", [0xff, 0xf1, 0x84, 0xc0]],
    ["reserved version", [0xff, 0xeb, 0x84, 0xc0]],
  ];
  it.each(cases)("%s is unmeasurable", (_name, h) => {
    const r = measureMp3DurationSeconds(withHeader(h));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unmeasurable");
  });

  it("ID3 size over buffer is unmeasurable", () => {
    const b = Buffer.concat([
      Buffer.from("ID3", "latin1"),
      Buffer.from([3, 0, 0, 0x00, 0x00, 0x7f, 0x7f]),
      Buffer.alloc(50),
    ]);
    const r = measureMp3DurationSeconds(b);
    expect(r.ok).toBe(false);
  });

  it("empty buffer is unmeasurable", () => {
    const r = measureMp3DurationSeconds(Buffer.alloc(0));
    expect(r.ok).toBe(false);
  });
});

describe("duration floor boundaries", () => {
  const passes = (seconds: number) => measure(buildMp3({ seconds }).bytes) >= MIN_EPISODE_SECONDS;

  it("rejects 59 seconds", () => {
    expect(passes(59)).toBe(false);
  });
  it("accepts exactly 60 seconds", () => {
    const built = buildMp3({ seconds: 60 });
    expect(measure(built.bytes)).toBeCloseTo(60, 9);
    expect(passes(60)).toBe(true);
  });
  it("accepts 61 seconds", () => {
    expect(passes(61)).toBe(true);
  });
});
