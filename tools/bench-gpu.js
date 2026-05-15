#!/usr/bin/env node
// GPU-5: `npm run gpu:bench` -- CPU-vs-GPU speedup benchmark for whisper.cpp.
//
// Goal: give the user a one-shot, reproducible answer to "is the GPU actually
// helping?" by running the same WAV through whisper-cli twice (once with
// --no-gpu, once with the binary's GPU defaults) and reporting:
//   - wall-clock time per run (min / median / mean of N runs)
//   - realtime factor (audio_seconds / wall_clock_seconds; higher = faster)
//   - speedup ratio (CPU_mean / GPU_mean; the headline number)
//
// The synthetic WAV is generated on the fly (deterministic; no binary in
// repo). Output:
//   - docs/gpu-bench-results.md   (committed, human-readable)
//   - recordings/.bench/<ts>.json (gitignored, machine-readable)
//
// This is the proof artifact that the cuBLAS binary from GPU-4 is actually
// using the GPU: when the binary is CPU-only, CPU_mean and GPU_mean are
// within noise of each other (speedup ≈ 1.0x); when it's CUDA-enabled, the
// speedup on this codebase's defaults is typically 2-10x depending on model.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { transcribeFile } = require('../src/transcribe');
const { detectGpu } = require('./check-gpu');
const { resolveWithVendor } = require('./check-transcribe-deps');

// ---------------------------------------------------------------------------
// Synthetic WAV generator
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_SECONDS = 10;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_BIT_DEPTH = 16;

// Deterministic mulberry32 PRNG so the same inputs always produce the same
// WAV. We don't want timings to drift because the input audio changed
// between runs.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a speech-like sample: a sum of three harmonics in the human
// vocal-range (250 / 750 / 1700 Hz) modulated by an AM envelope to mimic
// syllable pulses. The amplitude tops out at ~0.5 so whisper.cpp's energy
// detector doesn't skip it as silence, and the envelope keeps it from
// triggering its "constant tone" filter.
function generateBenchWav(filePath, {
  durationSeconds = DEFAULT_DURATION_SECONDS,
  sampleRate = DEFAULT_SAMPLE_RATE,
  bitDepth = DEFAULT_BIT_DEPTH,
  seed = 0xCa11ed,
} = {}) {
  const channels = 1;
  const bytesPerSample = bitDepth / 8;
  const totalSamples = Math.round(durationSeconds * sampleRate);
  const dataBytes = totalSamples * channels * bytesPerSample;
  const fileBytes = 44 + dataBytes;
  const buf = Buffer.alloc(fileBytes);
  // RIFF header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(fileBytes - 8, 4);
  buf.write('WAVE', 8, 'ascii');
  // fmt chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                                  // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bitDepth, 34);
  // data chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  const rand = mulberry32(seed);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Three harmonics; ~ vocal vowel.
    const carrier =
      0.40 * Math.sin(2 * Math.PI * 250  * t) +
      0.25 * Math.sin(2 * Math.PI * 750  * t) +
      0.15 * Math.sin(2 * Math.PI * 1700 * t);
    // AM envelope: ~5 Hz syllable pulses with a small random jitter.
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * t + rand() * 0.3);
    // Small additive noise for spectral coverage.
    const noise = (rand() - 0.5) * 0.05;
    const sample = Math.max(-1, Math.min(1, (carrier * env + noise) * 0.6));
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  return { filePath, durationSeconds, sampleRate, bytes: fileBytes };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function summarise(timingsMs) {
  if (!Array.isArray(timingsMs) || timingsMs.length === 0) return null;
  const sorted = timingsMs.slice().sort((a, b) => a - b);
  const mean = sorted.reduce((acc, n) => acc + n, 0) / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return { n: sorted.length, meanMs: mean, medianMs: median, minMs: min, maxMs: max };
}

function realtimeFactor(audioSeconds, wallMs) {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) return null;
  if (!Number.isFinite(wallMs) || wallMs <= 0) return null;
  return audioSeconds / (wallMs / 1000);
}

function speedup(cpuStats, gpuStats) {
  if (!cpuStats || !gpuStats) return null;
  if (!Number.isFinite(cpuStats.meanMs) || !Number.isFinite(gpuStats.meanMs) || gpuStats.meanMs <= 0) return null;
  return cpuStats.meanMs / gpuStats.meanMs;
}

// ---------------------------------------------------------------------------
// Run plan
// ---------------------------------------------------------------------------

function listAvailableModels(cwd = process.cwd()) {
  const modelsDir = path.join(cwd, 'models');
  try {
    return fs.readdirSync(modelsDir)
      .filter((n) => n.endsWith('.bin'))
      .map((n) => ({
        name: n.replace(/^ggml-/, '').replace(/\.bin$/, ''),
        path: path.join(modelsDir, n),
      }));
  } catch (_) { return []; }
}

async function runOne({ wav, model, gpu, threads }) {
  const start = process.hrtime.bigint();
  let result;
  try {
    result = await transcribeFile({ wav, model, threads, gpu, spawnFn: spawn });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const wallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  return { ok: true, wallMs, text: (result.text || '').trim().slice(0, 120) };
}

async function benchModel({ wav, audioSeconds, modelPath, modelName, runs = 3, threads = null, log = console.log }) {
  log(`\n[bench] model: ${modelName}`);
  const cpuTimings = [];
  const gpuTimings = [];

  // Warm-up: one untimed run per side so model-load and CUDA-context cost
  // doesn't skew the first timed sample.
  log(`[bench]   warmup (CPU)...`);
  await runOne({ wav, model: modelPath, gpu: false, threads });
  log(`[bench]   warmup (GPU)...`);
  await runOne({ wav, model: modelPath, gpu: null, threads });

  for (let i = 0; i < runs; i++) {
    const cpu = await runOne({ wav, model: modelPath, gpu: false, threads });
    if (cpu.ok) cpuTimings.push(cpu.wallMs);
    else log(`[bench]   CPU run ${i + 1} failed: ${cpu.error}`);
    log(`[bench]   CPU run ${i + 1}/${runs}: ${cpu.ok ? cpu.wallMs + ' ms' : 'FAIL'}`);
    const gpu = await runOne({ wav, model: modelPath, gpu: null, threads });
    if (gpu.ok) gpuTimings.push(gpu.wallMs);
    else log(`[bench]   GPU run ${i + 1} failed: ${gpu.error}`);
    log(`[bench]   GPU run ${i + 1}/${runs}: ${gpu.ok ? gpu.wallMs + ' ms' : 'FAIL'}`);
  }

  const cpuStats = summarise(cpuTimings);
  const gpuStats = summarise(gpuTimings);
  const cpuRtf = cpuStats ? realtimeFactor(audioSeconds, cpuStats.meanMs) : null;
  const gpuRtf = gpuStats ? realtimeFactor(audioSeconds, gpuStats.meanMs) : null;
  const sp = speedup(cpuStats, gpuStats);
  return {
    model: { name: modelName, path: modelPath },
    runs,
    cpu: { stats: cpuStats, realtimeFactor: cpuRtf, timingsMs: cpuTimings },
    gpu: { stats: gpuStats, realtimeFactor: gpuRtf, timingsMs: gpuTimings },
    speedup: sp,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatResultsMarkdown({ system, audioSeconds, sampleRate, results, ts }) {
  const lines = [];
  lines.push('# GPU benchmark results');
  lines.push('');
  lines.push(`Run at: ${ts}`);
  lines.push('');
  lines.push('## System');
  lines.push('');
  lines.push(`- Platform:   ${system.platform} ${system.arch}`);
  lines.push(`- Binary:     ${system.binary || '(not found)'}`);
  lines.push(`- Build:      ${system.cudaCapable ? 'cuBLAS / CUDA-enabled' : 'CPU-only (or unknown)'}`);
  lines.push(`- GPU:        ${system.gpuName || '(none detected)'}${system.gpuVramMb ? ` (${system.gpuVramMb} MiB)` : ''}`);
  lines.push(`- Driver:     ${system.gpuDriver || 'n/a'}`);
  lines.push(`- Sample:     ${audioSeconds.toFixed(1)} s @ ${sampleRate} Hz mono PCM (synthetic, deterministic)`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  if (results.length === 0) {
    lines.push('_No models were available on disk under `models/*.bin`. Run `npm run model:download-base` first._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| Model | CPU mean (ms) | CPU RTF | GPU mean (ms) | GPU RTF | Speedup |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const r of results) {
    const cpuMean = r.cpu.stats ? r.cpu.stats.meanMs.toFixed(0) : 'n/a';
    const cpuRtf = r.cpu.realtimeFactor != null ? `${r.cpu.realtimeFactor.toFixed(2)}x` : 'n/a';
    const gpuMean = r.gpu.stats ? r.gpu.stats.meanMs.toFixed(0) : 'n/a';
    const gpuRtf = r.gpu.realtimeFactor != null ? `${r.gpu.realtimeFactor.toFixed(2)}x` : 'n/a';
    const sp = r.speedup != null ? `${r.speedup.toFixed(2)}x` : 'n/a';
    lines.push(`| ${r.model.name} | ${cpuMean} | ${cpuRtf} | ${gpuMean} | ${gpuRtf} | ${sp} |`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- **CPU run:** whisper-cli invoked with `--no-gpu` (force CPU).');
  lines.push('- **GPU run:** whisper-cli invoked with no GPU flag (let the binary\'s build default decide).');
  lines.push('- A speedup of ~1.0x means the binary is CPU-only or the GPU is not being used.');
  lines.push('  Re-run `npm run gpu:check` to confirm the build is CUDA-enabled, or `npm run gpu:install`');
  lines.push('  to fetch a cuBLAS build.');
  lines.push('- Each row is `runs` timed samples + one warm-up. Mean is reported because variance on a');
  lines.push('  busy machine can be high; the JSON dump under `recordings/.bench/` keeps every sample.');
  lines.push('- Realtime factor (RTF) is `audio_seconds / wall_clock_seconds`. RTF > 1.0 means the');
  lines.push('  transcription was faster than realtime (necessary for live-meeting transcription).');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { runs: 3, durationSeconds: DEFAULT_DURATION_SECONDS, threads: null, models: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') out.runs = parseInt(argv[++i], 10) || out.runs;
    else if (a === '--duration') out.durationSeconds = parseFloat(argv[++i]) || out.durationSeconds;
    else if (a === '--threads') out.threads = parseInt(argv[++i], 10) || out.threads;
    else if (a === '--model') {
      out.models = out.models || [];
      out.models.push(argv[++i]);
    } else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) { out.error = `unknown flag: ${a}`; break; }
  }
  return out;
}

function printHelp() {
  console.log('Usage: npm run gpu:bench [-- --runs N --duration S --threads N --model PATH]');
  console.log('');
  console.log('Runs whisper-cli on a synthetic 10 s WAV under each available model in models/');
  console.log('twice (--no-gpu vs. default GPU). Prints a CPU/GPU speedup ratio and writes');
  console.log('docs/gpu-bench-results.md (committed) + recordings/.bench/<ts>.json (gitignored).');
  console.log('');
  console.log('Flags:');
  console.log('  --runs N       Timed runs per (model, gpu/cpu) cell. Default 3.');
  console.log('  --duration S   Audio length in seconds. Default 10.');
  console.log('  --threads N    CPU threads passed to whisper.cpp -t. Default: whisper.cpp picks.');
  console.log('  --model PATH   Override model auto-discovery. May be repeated.');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }
  if (args.error) { console.error(`Error: ${args.error}`); printHelp(); return 1; }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const benchDir = path.join(process.cwd(), 'recordings', '.bench');
  fs.mkdirSync(benchDir, { recursive: true });
  const wavPath = path.join(benchDir, `bench-${ts}.wav`);

  console.log(`[bench] generating synthetic ${args.durationSeconds.toFixed(1)} s WAV: ${wavPath}`);
  const wavInfo = generateBenchWav(wavPath, { durationSeconds: args.durationSeconds });

  const binary = resolveWithVendor();
  if (!binary) {
    console.error('FAIL: no whisper.cpp CLI found on PATH or under vendor/whisper-cuda/.');
    console.error('  Run `npm run transcribe:check` for install hints,');
    console.error('  or `npm run gpu:install` for the cuBLAS prebuilt.');
    return 1;
  }
  const probe = detectGpu();
  console.log(`[bench] binary:  ${binary}`);
  console.log(`[bench] cuda:    ${probe.binary.cudaCapable ? 'yes' : 'no (CPU-only build)'}`);
  console.log(`[bench] gpu:     ${probe.gpu.available ? probe.gpu.primary.name : '(none detected)'}`);

  // Resolve models. CLI override > auto-discovery.
  let models;
  if (args.models) {
    models = args.models.map((p) => ({
      name: path.basename(p).replace(/^ggml-/, '').replace(/\.bin$/, ''),
      path: path.isAbsolute(p) ? p : path.resolve(process.cwd(), p),
    }));
  } else {
    models = listAvailableModels();
  }
  if (models.length === 0) {
    console.error('FAIL: no models found under models/*.bin. Run `npm run model:download-base` first.');
    return 1;
  }
  console.log(`[bench] models:  ${models.map((m) => m.name).join(', ')}`);

  const results = [];
  for (const m of models) {
    if (!fs.existsSync(m.path)) {
      console.warn(`[bench] skipping ${m.name}: file not found at ${m.path}`);
      continue;
    }
    const r = await benchModel({
      wav: wavPath,
      audioSeconds: wavInfo.durationSeconds,
      modelPath: m.path,
      modelName: m.name,
      runs: args.runs,
      threads: args.threads,
    });
    results.push(r);
  }

  const tsHuman = new Date().toISOString();
  const system = {
    platform: process.platform,
    arch: process.arch,
    binary,
    cudaCapable: !!(probe.binary && probe.binary.cudaCapable),
    gpuName: probe.gpu && probe.gpu.primary ? probe.gpu.primary.name : null,
    gpuVramMb: probe.gpu && probe.gpu.primary ? probe.gpu.primary.vramMb : null,
    gpuDriver: probe.gpu && probe.gpu.primary ? probe.gpu.primary.driver : null,
  };
  const md = formatResultsMarkdown({ system, audioSeconds: wavInfo.durationSeconds, sampleRate: wavInfo.sampleRate, results, ts: tsHuman });
  const mdPath = path.join(process.cwd(), 'docs', 'gpu-bench-results.md');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, md);
  console.log(`[bench] wrote:   ${mdPath}`);

  const jsonPath = path.join(benchDir, `bench-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ ts: tsHuman, system, audioSeconds: wavInfo.durationSeconds, results }, null, 2) + '\n');
  console.log(`[bench] wrote:   ${jsonPath}`);

  console.log('');
  console.log('[bench] summary:');
  for (const r of results) {
    const sp = r.speedup != null ? `${r.speedup.toFixed(2)}x` : 'n/a';
    const cpuRtf = r.cpu.realtimeFactor != null ? `${r.cpu.realtimeFactor.toFixed(2)}x` : 'n/a';
    const gpuRtf = r.gpu.realtimeFactor != null ? `${r.gpu.realtimeFactor.toFixed(2)}x` : 'n/a';
    console.log(`  ${r.model.name.padEnd(14)}  CPU RTF ${cpuRtf.padStart(7)}  GPU RTF ${gpuRtf.padStart(7)}  speedup ${sp}`);
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => { if (code !== 0) process.exit(code); })
    .catch((err) => { console.error('Unexpected error in gpu:bench:', err); process.exit(2); });
}

module.exports = {
  main,
  generateBenchWav,
  summarise,
  realtimeFactor,
  speedup,
  formatResultsMarkdown,
  listAvailableModels,
  parseArgs,
  mulberry32,
};
