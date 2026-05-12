#!/usr/bin/env node
// 2-second real-hardware sanity check for the listen pipeline (MS-3).
// Captures audio via AudioRecorder.listen, computes max peak across the window,
// and prints a JSON line. Useful for verifying sox + node-record-lpcm16 work
// end-to-end without involving the CLI's TTY rendering.

const AudioRecorder = require('../src/audioRecorder');
const { peak16LE, toDb } = require('../src/audioLevels');

const DURATION_MS = Number.parseInt(process.argv[2], 10) || 2000;

const recorder = new AudioRecorder();
let chunks = 0;
let totalBytes = 0;
let maxPeak = 0;
let started = Date.now();

try {
  recorder.listen((chunk) => {
    chunks += 1;
    totalBytes += chunk.length;
    const p = peak16LE(chunk);
    if (p > maxPeak) maxPeak = p;
  });
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}

setTimeout(() => {
  const elapsedMs = Date.now() - started;
  try { recorder.stop(); } catch (_) { /* already stopped */ }
  console.log(JSON.stringify({
    ok: true,
    elapsedMs,
    chunks,
    totalBytes,
    maxPeak,
    maxPeakDb: toDb(maxPeak),
  }));
  setTimeout(() => process.exit(0), 50);
}, DURATION_MS);
