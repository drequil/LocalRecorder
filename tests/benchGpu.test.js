// GPU-5: unit tests for the bench tool's pure helpers. The actual whisper.cpp
// invocations are integration-only and exercised by `npm run gpu:bench` on a
// real workstation; here we pin the WAV generator (so byte-for-byte identical
// across runs), the stats math, the markdown formatter, and the argv parser.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  generateBenchWav,
  summarise,
  realtimeFactor,
  speedup,
  formatResultsMarkdown,
  parseArgs,
  mulberry32,
} = require('../tools/bench-gpu');

let tmpdir;
beforeAll(() => { tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-bench-')); });
afterAll(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

describe('mulberry32', () => {
  test('is deterministic for a given seed', () => {
    const a = mulberry32(0x1234);
    const b = mulberry32(0x1234);
    const aSeq = Array.from({ length: 5 }, () => a());
    const bSeq = Array.from({ length: 5 }, () => b());
    expect(aSeq).toEqual(bSeq);
  });

  test('produces values in [0, 1)', () => {
    const rand = mulberry32(0xCa11ed);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateBenchWav', () => {
  test('writes a valid RIFF/WAVE header', () => {
    const p = path.join(tmpdir, 'a.wav');
    generateBenchWav(p, { durationSeconds: 1 });
    const buf = fs.readFileSync(p);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ');
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    // 16 kHz mono 16-bit -> bytesPerSecond = 32000
    expect(buf.readUInt32LE(24)).toBe(16000);   // sample rate
    expect(buf.readUInt16LE(22)).toBe(1);       // channels
    expect(buf.readUInt16LE(34)).toBe(16);      // bit depth
  });

  test('file size matches the expected payload byte count', () => {
    const p = path.join(tmpdir, 'b.wav');
    generateBenchWav(p, { durationSeconds: 2 });
    const buf = fs.readFileSync(p);
    // 2 s * 16000 sample rate * 1 ch * 2 bytes/sample = 64000 + 44 header
    expect(buf.length).toBe(64044);
    expect(buf.readUInt32LE(40)).toBe(64000); // data chunk size
  });

  test('is byte-for-byte deterministic across regenerations with the same seed', () => {
    const p1 = path.join(tmpdir, 'c1.wav');
    const p2 = path.join(tmpdir, 'c2.wav');
    generateBenchWav(p1, { durationSeconds: 1, seed: 0x42 });
    generateBenchWav(p2, { durationSeconds: 1, seed: 0x42 });
    const h1 = crypto.createHash('sha256').update(fs.readFileSync(p1)).digest('hex');
    const h2 = crypto.createHash('sha256').update(fs.readFileSync(p2)).digest('hex');
    expect(h1).toBe(h2);
  });

  test('different seeds produce different audio bodies', () => {
    const p1 = path.join(tmpdir, 'd1.wav');
    const p2 = path.join(tmpdir, 'd2.wav');
    generateBenchWav(p1, { durationSeconds: 1, seed: 1 });
    generateBenchWav(p2, { durationSeconds: 1, seed: 2 });
    const bodyA = fs.readFileSync(p1).slice(44);
    const bodyB = fs.readFileSync(p2).slice(44);
    expect(Buffer.compare(bodyA, bodyB)).not.toBe(0);
  });

  test('returned info matches what was actually written', () => {
    const p = path.join(tmpdir, 'e.wav');
    const info = generateBenchWav(p, { durationSeconds: 3 });
    expect(info.filePath).toBe(p);
    expect(info.durationSeconds).toBe(3);
    expect(info.sampleRate).toBe(16000);
    expect(info.bytes).toBe(44 + 3 * 16000 * 2);
  });
});

describe('summarise', () => {
  test('returns null for empty input', () => {
    expect(summarise([])).toBeNull();
    expect(summarise(null)).toBeNull();
  });

  test('computes mean, median, min, max for an odd-count series', () => {
    const out = summarise([100, 200, 300]);
    expect(out.n).toBe(3);
    expect(out.minMs).toBe(100);
    expect(out.maxMs).toBe(300);
    expect(out.meanMs).toBe(200);
    expect(out.medianMs).toBe(200);
  });

  test('median is the average of the two middle values on an even-count series', () => {
    const out = summarise([100, 200, 300, 400]);
    expect(out.medianMs).toBe(250);
  });

  test('handles a single sample (median = mean = min = max)', () => {
    const out = summarise([42]);
    expect(out).toEqual({ n: 1, meanMs: 42, medianMs: 42, minMs: 42, maxMs: 42 });
  });
});

describe('realtimeFactor', () => {
  test('returns audio_seconds / wall_seconds', () => {
    expect(realtimeFactor(10, 1000)).toBe(10);    // 10 s audio in 1 s wall = 10x
    expect(realtimeFactor(10, 10000)).toBe(1);    // realtime
    expect(realtimeFactor(10, 20000)).toBe(0.5);  // slower than realtime
  });

  test('returns null on invalid input', () => {
    expect(realtimeFactor(0, 1000)).toBeNull();
    expect(realtimeFactor(10, 0)).toBeNull();
    expect(realtimeFactor(-1, 1000)).toBeNull();
    expect(realtimeFactor(10, NaN)).toBeNull();
  });
});

describe('speedup', () => {
  test('returns cpuMean / gpuMean', () => {
    expect(speedup({ meanMs: 1000 }, { meanMs: 250 })).toBe(4);
    expect(speedup({ meanMs: 500 }, { meanMs: 500 })).toBe(1);
  });

  test('returns null when either stats are missing or gpuMean is 0', () => {
    expect(speedup(null, { meanMs: 100 })).toBeNull();
    expect(speedup({ meanMs: 100 }, null)).toBeNull();
    expect(speedup({ meanMs: 100 }, { meanMs: 0 })).toBeNull();
  });
});

describe('formatResultsMarkdown', () => {
  test('renders a clear "no models" message when results are empty', () => {
    const md = formatResultsMarkdown({
      system: { platform: 'win32', arch: 'x64', binary: 'x', cudaCapable: true, gpuName: 'RTX 4070 Ti', gpuVramMb: 12282, gpuDriver: '560' },
      audioSeconds: 10, sampleRate: 16000, results: [], ts: '2026-05-15T00:00:00Z',
    });
    expect(md).toMatch(/No models were available/);
    expect(md).toMatch(/RTX 4070 Ti/);
  });

  test('renders a results table with one row per model', () => {
    const md = formatResultsMarkdown({
      system: { platform: 'win32', arch: 'x64', binary: 'whisper-cli', cudaCapable: true, gpuName: 'RTX 4070 Ti', gpuVramMb: 12282, gpuDriver: '560' },
      audioSeconds: 10, sampleRate: 16000,
      results: [
        {
          model: { name: 'base.en', path: 'm.bin' }, runs: 3,
          cpu: { stats: { meanMs: 1000 }, realtimeFactor: 10.0, timingsMs: [1000, 1000, 1000] },
          gpu: { stats: { meanMs: 250 }, realtimeFactor: 40.0, timingsMs: [250, 250, 250] },
          speedup: 4.0,
        },
        {
          model: { name: 'medium.en', path: 'm.bin' }, runs: 3,
          cpu: { stats: { meanMs: 5000 }, realtimeFactor: 2.0, timingsMs: [] },
          gpu: { stats: { meanMs: 1250 }, realtimeFactor: 8.0, timingsMs: [] },
          speedup: 4.0,
        },
      ],
      ts: '2026-05-15T00:00:00Z',
    });
    expect(md).toMatch(/\| Model \|/);
    expect(md).toMatch(/\| base\.en \|/);
    expect(md).toMatch(/\| medium\.en \|/);
    expect(md).toMatch(/4\.00x/);
  });

  test('reports CPU-only build clearly', () => {
    const md = formatResultsMarkdown({
      system: { platform: 'win32', arch: 'x64', binary: 'whisper-cli', cudaCapable: false, gpuName: null, gpuVramMb: null, gpuDriver: null },
      audioSeconds: 10, sampleRate: 16000, results: [], ts: '2026-05-15T00:00:00Z',
    });
    expect(md).toMatch(/CPU-only \(or unknown\)/);
  });
});

describe('parseArgs', () => {
  test('returns defaults when no flags', () => {
    expect(parseArgs([])).toEqual({ runs: 3, durationSeconds: 10, threads: null, models: null });
  });

  test('parses --runs / --duration / --threads', () => {
    const out = parseArgs(['--runs', '5', '--duration', '15.5', '--threads', '8']);
    expect(out.runs).toBe(5);
    expect(out.durationSeconds).toBe(15.5);
    expect(out.threads).toBe(8);
  });

  test('supports repeated --model flags', () => {
    const out = parseArgs(['--model', 'a.bin', '--model', 'b.bin']);
    expect(out.models).toEqual(['a.bin', 'b.bin']);
  });

  test('sets error on unknown flags', () => {
    const out = parseArgs(['--bogus']);
    expect(out.error).toMatch(/unknown flag/);
  });
});
