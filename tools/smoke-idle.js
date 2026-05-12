#!/usr/bin/env node
// Real-hardware sanity check for AudioRecorder.idleListen (MS-6).
// Starts an idle-listen session pointed at a fresh temp directory, waits
// N seconds (during which sox rotates one or more chunks based on the
// silence detector's view of ambient sound), then calls recorder.stop().
// After the fileStreams close, the MS-4.5 header fixup should fire for
// each chunk. We then list the produced files, parse each header, and
// optionally run `sox <chunk> -n stat` to confirm the file is playable.
//
// Usage:
//   node tools/smoke-idle.js [outputDir=./smoke-idle-<pid>] [durationMs=8000]

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AudioRecorder = require('../src/audioRecorder');
const { sidecarPathFor, SIDECAR_SCHEMA_VERSION } = require('../src/chunkSidecar');

const outputDir = path.resolve(
  process.argv[2] || path.join(os.tmpdir(), `localrecorder-smoke-idle-${process.pid}`),
);
const durationMs = Number.parseInt(process.argv[3], 10) || 8000;
const thresholdPercent = process.env.SMOKE_IDLE_THRESHOLD
  ? Number(process.env.SMOKE_IDLE_THRESHOLD)
  : null;

function readWavHeader(buf) {
  if (buf.length < 44) return { ok: false, reason: `too small (${buf.length} bytes)` };
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  if (riff !== 'RIFF') return { ok: false, reason: `bad RIFF magic: ${JSON.stringify(riff)}` };
  if (wave !== 'WAVE') return { ok: false, reason: `bad WAVE magic: ${JSON.stringify(wave)}` };
  let cursor = 12;
  while (cursor + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', cursor, cursor + 4);
    const chunkSize = buf.readUInt32LE(cursor + 4);
    if (chunkId === 'data') {
      return { ok: true, riffSize: buf.readUInt32LE(4), dataOffset: cursor + 8, dataSize: chunkSize };
    }
    cursor += 8 + chunkSize;
    if (chunkSize % 2 === 1) cursor += 1;
  }
  return { ok: false, reason: 'no data chunk found' };
}

function runSoxStat(filePath) {
  const r = spawnSync('sox', [filePath, '-n', 'stat'], { encoding: 'utf8' });
  return {
    exitCode: r.status,
    stderrExcerpt: (r.stderr || '')
      .split(/\r?\n/)
      .filter((l) => /Samples read|Length|Maximum amplitude|RMS\s+amplitude/.test(l))
      .map((l) => l.trim()),
  };
}

const recorder = new AudioRecorder(
  thresholdPercent !== null ? { idleThreshold: thresholdPercent } : {},
);
try {
  recorder.idleListen(outputDir);
} catch (err) {
  console.error(JSON.stringify({ ok: false, stage: 'idleListen', error: err.message, outputDir }));
  process.exit(1);
}

setTimeout(() => {
  try {
    recorder.stop();
  } catch (err) {
    console.error(JSON.stringify({ ok: false, stage: 'stop', error: err.message }));
    process.exit(1);
  }

  // Header fixup runs after each fileStream's 'close' event; give the OS a beat.
  setTimeout(() => {
    let entries;
    try {
      entries = fs.readdirSync(outputDir)
        .filter((n) => n.endsWith('.wav'))
        .sort();
    } catch (err) {
      console.error(JSON.stringify({ ok: false, stage: 'readdir', error: err.message, outputDir }));
      process.exit(1);
    }

    const chunks = entries.map((name) => {
      const filePath = path.join(outputDir, name);
      const stat = fs.statSync(filePath);
      const buf = fs.readFileSync(filePath);
      const header = readWavHeader(buf);
      const soxStat = runSoxStat(filePath);
      const dataSizeMatchesFile = header.ok
        ? header.dataSize === stat.size - header.dataOffset
        : false;
      const sidecarPath = sidecarPathFor(filePath);
      let sidecar = { ok: false, reason: 'not found' };
      try {
        const raw = fs.readFileSync(sidecarPath, 'utf8');
        const parsed = JSON.parse(raw);
        const required = ['version', 'wav', 'start', 'end', 'durationMs', 'audio', 'peak', 'peakDb', 'bytes'];
        const missing = required.filter((k) => !(k in parsed));
        sidecar = {
          ok: missing.length === 0 && parsed.version === SIDECAR_SCHEMA_VERSION && parsed.wav === name,
          missing,
          parsed,
        };
      } catch (err) {
        sidecar = { ok: false, reason: err.message };
      }
      return {
        name,
        fileSize: stat.size,
        header,
        dataSizeMatchesFile,
        soxStatExitCode: soxStat.exitCode,
        soxStatExcerpt: soxStat.stderrExcerpt,
        sidecar,
      };
    });

    const allHeadersOk = chunks.every((c) => c.header.ok);
    const allFixed = chunks.every((c) => c.dataSizeMatchesFile);
    const allSoxOk = chunks.every((c) => c.soxStatExitCode === 0);
    const allSidecarsOk = chunks.every((c) => c.sidecar.ok);

    // No chunks is a valid outcome in a quiet room: sox waited for audio above
    // the threshold and the empty-chunk cleanup in stop() removed the placeholder.
    // What we really validate is "no chunks survived that aren't structurally OK."
    const result = {
      ok: allHeadersOk && allFixed && allSoxOk && allSidecarsOk,
      outputDir,
      durationMs,
      thresholdPercent,
      chunkCount: chunks.length,
      chunks,
    };

    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }, 300);
}, durationMs);
