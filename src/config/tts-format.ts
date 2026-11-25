/**
 * Assumed audio format of the TTS provider's MP3 output. Used by the Polly request
 * builder and the test MP3 builder. The duration parser reads each frame header
 * and does not depend on these values.
 */
export const ASSUMED_TTS_AUDIO_FORMAT = {
  mpegVersion: "MPEG-2", // MPEG audio version of the provider's MP3 frames (assumed)
  layer: 3, // MPEG audio layer; 3 = Layer III
  sampleRateHz: 24000, // output sample rate in Hz (Polly neural default)
  channels: 1, // 1 = mono; frame header channel mode "single channel"
  bitrateMode: "unverified; the parser handles CBR and VBR per frame", // real mode of provider output NOT verified
  fakeBitrateKbps: 48, // CBR bitrate in kbit/s used ONLY to build the fake; not a claim about the provider
} as const;
