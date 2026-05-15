#!/usr/bin/env node
// GPU-1: probe for an NVIDIA GPU + a CUDA-built whisper.cpp binary.
//
// Two independent checks, reported separately so the user can tell whether
// the problem is "no GPU" vs. "GPU present but my whisper-cli is CPU-only":
//
//   1. GPU presence — `nvidia-smi --query-gpu=...` (NVIDIA only for now;
//      AMD/Intel/Apple paths can be added later).
//   2. CUDA capability of the whisper.cpp binary — spawn `<whisper-cli> --help`
//      and scan for tokens that only appear in CUDA-enabled builds
//      (`--no-gpu`, `-ngl`, `cublas`, `gpu`).
//
// The CLI entry prints a human-readable summary. The exported `detectGpu()` is
// the function the rest of the project (server.js, audioRecorder.js, the
// transcribe layer) consumes. It is cached at module level so a server that
// stays up doesn't reprobe on every request.

'use strict';

const { spawnSync } = require('child_process');
const {
  WHISPER_CANDIDATES,
  pickCandidateBinary,
  probeBinary,
  findOnPath,
} = require('./check-transcribe-deps');

// Strings only present in whisper.cpp builds that linked cuBLAS / CUDA.
// We OR all of them so the probe survives whisper.cpp help-text rewrites that
// drop one phrasing for another.
const CUDA_HELP_TOKENS = Object.freeze([
  '--no-gpu',
  '-ngl',
  '--n-gpu-layers',
  'cublas',
  'CUDA',
  'use gpu',
]);

function runNvidiaSmi({ runner = spawnSync } = {}) {
  // --format=csv,noheader produces e.g.
  //   NVIDIA GeForce RTX 4080 Ti, 16376 MiB, 552.22
  // One row per detected GPU. We return them all so a multi-GPU host shows up.
  try {
    const result = runner(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.error) return { available: false, reason: result.error.code || result.error.message };
    if (result.status !== 0) {
      const stderrLine = (result.stderr || '').split(/\r?\n/).find(Boolean) || `exit ${result.status}`;
      return { available: false, reason: stderrLine.trim() };
    }
    const rows = (result.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(',').map((s) => s.trim());
        const name = parts[0] || '(unknown)';
        const vramMb = Number.parseInt(parts[1], 10);
        const driver = parts[2] || null;
        return {
          name,
          vramMb: Number.isFinite(vramMb) ? vramMb : null,
          driver,
        };
      });
    if (rows.length === 0) return { available: false, reason: 'nvidia-smi returned no rows' };
    return {
      available: true,
      vendor: 'nvidia',
      devices: rows,
      // First device is the one whisper.cpp will pick by default unless
      // CUDA_VISIBLE_DEVICES says otherwise.
      primary: rows[0],
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

// Inspect a whisper.cpp binary's --help text and decide whether it was built
// with CUDA. Returns { cudaCapable, sawFlags } so callers can print a friendly
// explanation when cudaCapable is false.
function inspectWhisperBuild({ probe = probeBinary, candidates = WHISPER_CANDIDATES } = {}) {
  const pick = pickCandidateBinary(candidates, probe);
  if (!pick.picked) {
    return {
      binary: null,
      binaryPath: null,
      cudaCapable: false,
      sawFlags: [],
      reason: 'no whisper.cpp CLI on PATH',
    };
  }
  const help = `${pick.result.stdout || ''}\n${pick.result.stderr || ''}`;
  const lower = help.toLowerCase();
  const sawFlags = [];
  for (const token of CUDA_HELP_TOKENS) {
    if (lower.includes(token.toLowerCase())) sawFlags.push(token);
  }
  return {
    binary: pick.picked,
    binaryPath: findOnPath(pick.picked) || null,
    cudaCapable: sawFlags.length > 0,
    sawFlags,
    reason: sawFlags.length > 0 ? null : 'help text shows no CUDA flags',
  };
}

// Combined probe. Cached at module level — the result rarely changes during
// a server's lifetime (driver upgrades and binary swaps are rare and the user
// will restart us anyway).
let _cached = null;
function detectGpu({ refresh = false } = {}) {
  if (_cached && !refresh) return _cached;
  const gpu = runNvidiaSmi();
  const binary = inspectWhisperBuild();
  // "Effective" GPU acceleration is available only when BOTH the device and
  // a CUDA-capable binary are present. The two halves are reported separately
  // so the user can see which side is missing.
  const effective = gpu.available && binary.cudaCapable;
  _cached = { gpu, binary, effective };
  return _cached;
}

function printHumanSummary(info) {
  const lines = [];
  lines.push('GPU probe:');
  if (info.gpu.available) {
    const p = info.gpu.primary;
    lines.push(`  device:  ${p.name}${p.vramMb ? ` (${p.vramMb} MiB)` : ''}`);
    if (p.driver) lines.push(`  driver:  ${p.driver}`);
    if (info.gpu.devices.length > 1) {
      lines.push(`  (+ ${info.gpu.devices.length - 1} more device${info.gpu.devices.length > 2 ? 's' : ''})`);
    }
  } else {
    lines.push(`  device:  not detected (${info.gpu.reason})`);
  }
  lines.push('');
  lines.push('whisper.cpp build:');
  if (info.binary.binary) {
    lines.push(`  binary:  ${info.binary.binaryPath || info.binary.binary}`);
    if (info.binary.cudaCapable) {
      lines.push(`  cuda:    yes (saw: ${info.binary.sawFlags.join(', ')})`);
    } else {
      lines.push(`  cuda:    no (${info.binary.reason})`);
    }
  } else {
    lines.push('  binary:  not found on PATH');
    lines.push('  hint:    run `npm run transcribe:check` for install instructions');
  }
  lines.push('');
  if (info.effective) {
    lines.push('==> GPU acceleration is AVAILABLE. Transcription will use the GPU by default.');
    lines.push('    Pass --no-gpu on record / idle / transcribe to force CPU.');
  } else if (info.gpu.available && info.binary.binary && !info.binary.cudaCapable) {
    lines.push('==> GPU is present but your whisper.cpp build is CPU-only.');
    lines.push('    Run `npm run gpu:install` (added in GPU-4) to fetch a cuBLAS build,');
    lines.push('    or grab the cuBLAS release ZIP manually:');
    lines.push('      https://github.com/ggerganov/whisper.cpp/releases');
  } else if (!info.gpu.available && info.binary.cudaCapable) {
    lines.push('==> CUDA-built whisper.cpp is on PATH but no NVIDIA GPU was found.');
    lines.push('    Transcription will fall back to CPU.');
  } else {
    lines.push('==> No GPU acceleration. Transcription will run on CPU (today\'s baseline).');
  }
  return lines.join('\n');
}

async function main() {
  const info = detectGpu({ refresh: true });
  console.log(printHumanSummary(info));
  // Exit 0 even when GPU is unavailable — this is a probe, not a hard check.
  // GPU-2's runtime defaults are what flip CPU/GPU per chunk.
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => { if (code !== 0) process.exit(code); })
    .catch((err) => {
      console.error('Unexpected error in gpu:check:', err);
      process.exit(2);
    });
}

module.exports = {
  CUDA_HELP_TOKENS,
  runNvidiaSmi,
  inspectWhisperBuild,
  detectGpu,
  printHumanSummary,
  main,
};
