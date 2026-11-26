import { buildDefaultFakeTtsMp3 } from "../../test/helpers/mp3.js";
import type { TtsAdapter } from "./tts.js";

/** Fake adapter: returns the default MP3 (variant d, about 35 s) without any network call. */
export function createFakeTtsAdapter(seconds = 35): TtsAdapter {
  return {
    async synthesize() {
      return { ok: true, value: buildDefaultFakeTtsMp3(seconds).bytes };
    },
  };
}
