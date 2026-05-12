#!/usr/bin/env node
// Real-hardware sanity check for AudioRecorder.start (MS-4).
// Captures N seconds of audio to a WAV file, calls recorder.stop() (not SIGINT),
// then validates the produced file: RIFF/WAVE magic, non-empty data chunk,
// and (optionally) round-trips through `sox <file> -n stat` to confirm the
// content is actually playable PCM. Exits 0 on success, 1 on failure.
//
// Usage:
//   node tools/smoke-record.js [path=./smoke-record.wav] [durationMs=2000]

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AudioRecorder = require('../src/audioRecorder');

const outputArg = process.argv[2] || path.join(__dirname, '..', 'smoke-record.wav');
const outputPath = path.resolve(outputArg);
const durationMs = Number.parseInt(process.argv[3], 10) || 2000;

function readWavHeader(buf) {
  if (buf.length < 44) return { ok: false, reason: 'file shorter than minimum WAV header (44 bytes)' };
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  if (riff !== 'RIFF') return { ok: false, reason: `first 4 bytes are ${JSON.stringify(riff)}, expected "RIFF"` };
  if (wave !== 'WAVE') return { ok: false, reason: `bytes 8-12 are ${JSON.stringify(wave)}, expected "WAVE"` };

  // Walk chunks looking for "data".
  let cursor = 12;
  while (cursor + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', cursor, cursor + 4);
    const chunkSize = buf.readUInt32LE(cursor + 4);
    if (chunkId === 'data') {
      return { ok: true, dataOffset: cursor + 8, dataSize: chunkSize, riff, wave };
    }
    cursor += 8 + chunkSize;
    if (chunkSize % 2 === 1) cursor += 1; // chunk word alignment
  }
  return { ok: false, reason: 'no data chunk found' };
}

function runSoxStat(filePath) {
  // sox <file> -n stat writes diagnostics to stderr.
  const result = spawnSync('sox', [filePath, '-n', 'stat'], { encoding: 'utf8' });
  return {
    exitCode: result.status,
    stderr: result.stderr || '',
    stdout: result.stdout || '',
  };
}

const recorder = new AudioRecorder();
try {
  recorder.start(outputPath);
} catch (err) {
  console.error(JSON.stringify({ ok: false, stage: 'start', error: err.message }));
  process.exit(1);
}

setTimeout(() => {
  try {
    recorder.stop();
  } catch (err) {
    console.error(JSON.stringify({ ok: false, stage: 'stop', error: err.message }));
    process.exit(1);
  }

  // Give the OS a moment to flush the closed fileStream.
  setTimeout(() => {
    if (!fs.existsSync(outputPath)) {
      console.error(JSON.stringify({ ok: false, stage: 'fs', error: 'output file was not created', outputPath }));
      process.exit(1);
    }

    const stat = fs.statSync(outputPath);
    const fileSize = stat.size;
    if (fileSize < 100) {
      console.error(JSON.stringify({ ok: false, stage: 'fs', error: `output file too small (${fileSize} bytes)`, outputPath }));
      process.exit(1);
    }

    const buf = fs.readFileSync(outputPath);
    const header = readWavHeader(buf);
    const soxStat = runSoxStat(outputPath);

    const result = {
      ok: header.ok && soxStat.exitCode === 0,
      outputPath,
      fileSize,
      durationMs,
      header,
      soxStatExitCode: soxStat.exitCode,
      // sox stat reports values like "Length (seconds):    2.048000".
      soxStatExcerpt: soxStat.stderr
        .split(/\r?\n/)
        .filter((l) => /Length|Samples read|RMS amplitude|Maximum amplitude/.test(l))
        .map((l) => l.trim()),
    };

    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }, 200);
}, durationMs);
