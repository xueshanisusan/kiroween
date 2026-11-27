/**
 * Audio format of the MP3 the TTS adapter produces. The ffmpeg arguments are built
 * from sampleRateHz, channels and fakeBitrateKbps, and the test MP3 builder uses
 * them too. The duration parser reads each frame header and does not depend on
 * these values.
 */
export const ASSUMED_TTS_AUDIO_FORMAT = {
  mpegVersion: "MPEG-2", // MPEG audio version of the encoded MP3 frames (implied by the ffmpeg arguments)
  layer: 3, // MPEG audio layer; 3 = Layer III
  sampleRateHz: 24000, // output sample rate in Hz (ffmpeg -ar)
  channels: 1, // 1 = mono (ffmpeg -ac); frame header channel mode "single channel"
  bitrateMode: "CBR", // verified by audit 18.1: ffprobe reports 48000 bit/s and ffmpeg writes an Info (CBR) header frame
  fakeBitrateKbps: 48, // CBR bitrate in kbit/s (ffmpeg -b:a) and the bitrate of the test fake
} as const;
