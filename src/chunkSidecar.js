// MS-8 chunk sidecar metadata: a small JSON file written alongside each
// idle-mode WAV chunk, describing what's inside the wav without having to
// open it. Downstream consumers (the eventual Whisper transcription stage,
// search index, heat-trend analyzer, human-review UI) can read this without
// parsing a single byte of audio.
//
// Sidecar schema version 1:
//   {
//     "version": 1,
//     "wav": "chunk-YYYYMMDD-HHMMSS-mmm.wav",
//     "start": ISO8601 string,
//     "end":   ISO8601 string,
//     "durationMs": number, // derived from the audio payload, not wall clock
//     "audio": { sampleRate, channels, bitDepth, encoding },
//     "peak":   number,   // normalized 0..1
//     "peakDb": number,   // dBFS (-Infinity-floored at -120 by toDb)
//     "bytes":  number    // size of the wav file on disk
//   }

const fs = require('fs');
const path = require('path');

const SIDECAR_SCHEMA_VERSION = 1;
const BYTES_PER_INT16_SAMPLE = 2;

function sidecarPathFor(wavPath) {
  const dir = path.dirname(wavPath);
  const base = path.basename(wavPath, path.extname(wavPath));
  return path.join(dir, `${base}.json`);
}

function audioDurationMs({ fileSize, dataPayloadOffset, sampleRate, channels, bitDepth }) {
  if (!Number.isFinite(fileSize) || fileSize <= dataPayloadOffset) return 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  if (!Number.isFinite(channels) || channels <= 0) return 0;
  const bytesPerSample = (bitDepth || 16) / 8;
  const audioBytes = fileSize - dataPayloadOffset;
  const frames = audioBytes / (channels * bytesPerSample);
  return Math.round((frames / sampleRate) * 1000);
}

function buildSidecar({
  wavPath,
  start,
  end,
  fileSize,
  dataPayloadOffset,
  format,
  peak,
  peakDb,
}) {
  const audio = {
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitDepth: format.bitDepth,
    encoding: format.encoding,
  };
  return {
    version: SIDECAR_SCHEMA_VERSION,
    wav: path.basename(wavPath),
    start: start instanceof Date ? start.toISOString() : start,
    end: end instanceof Date ? end.toISOString() : end,
    durationMs: audioDurationMs({
      fileSize,
      dataPayloadOffset,
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      bitDepth: audio.bitDepth,
    }),
    audio,
    peak,
    peakDb,
    bytes: fileSize,
  };
}

function writeSidecar(wavPath, sidecar) {
  const target = sidecarPathFor(wavPath);
  fs.writeFileSync(target, JSON.stringify(sidecar, null, 2) + '\n');
  return target;
}

module.exports = {
  SIDECAR_SCHEMA_VERSION,
  BYTES_PER_INT16_SAMPLE,
  sidecarPathFor,
  audioDurationMs,
  buildSidecar,
  writeSidecar,
};
