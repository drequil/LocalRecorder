// GPU-6: integration smoke. The plan calls for a single test that exercises
// the full GPU path end-to-end on real hardware -- and skips cleanly with a
// clear `[skipped: no CUDA whisper.cpp]` message on CPU-only machines / CI,
// so the suite never goes red just because the runner lacks a GPU.
//
// What gets exercised when the gate opens:
//   - detectGpu() reports an effective CUDA stack (binary + nvidia-smi).
//   - generateBenchWav() produces a real WAV that whisper.cpp will accept.
//   - transcribeFile({ gpu: null }) runs the binary's GPU default path and
//     returns a structured result (text, gpu, gpuLayers echoed).
//   - transcribeFile({ gpu: false }) round-trips the --no-gpu override.
// The CPU baseline test is on by default so we always at least verify the
// shape of the result object, even when no GPU is present.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { detectGpu } = require('../tools/check-gpu');
const { generateBenchWav } = require('../tools/bench-gpu');
const { transcribeFile } = require('../src/transcribe');

const probe = detectGpu();
const cudaEffective = !!(probe && probe.effective);

// Pick the smallest model on disk to keep the integration test fast.
function pickSmallestModel() {
  const modelsDir = path.join(process.cwd(), 'models');
  let entries;
  try { entries = fs.readdirSync(modelsDir); } catch (_) { return null; }
  const bins = entries.filter((n) => n.endsWith('.bin')).map((n) => {
    const full = path.join(modelsDir, n);
    return { name: n, full, size: fs.statSync(full).size };
  });
  if (bins.length === 0) return null;
  bins.sort((a, b) => a.size - b.size);
  return bins[0].full;
}

const modelPath = pickSmallestModel();

if (!cudaEffective) {
  // eslint-disable-next-line no-console
  console.log(`[skipped: no CUDA whisper.cpp] gpu=${probe?.gpu?.available ? 'yes' : 'no'} binary.cudaCapable=${probe?.binary?.cudaCapable ? 'yes' : 'no'}`);
}
if (cudaEffective && !modelPath) {
  // eslint-disable-next-line no-console
  console.log('[skipped: no models on disk] place a ggml-*.bin under models/');
}

const gpuItIf = (cudaEffective && modelPath) ? test : test.skip;

describe('GPU integration smoke', () => {
  // Always runs: this verifies the probe at least returns the structured
  // shape we depend on. No spawn here -- detectGpu() is memoised at module
  // load, so this just inspects the cached probe result.
  test('detectGpu() returns the documented shape', () => {
    expect(probe).toEqual(expect.objectContaining({
      gpu: expect.any(Object),
      binary: expect.any(Object),
      effective: expect.any(Boolean),
    }));
    expect(typeof probe.gpu.available).toBe('boolean');
    expect(typeof probe.binary.cudaCapable).toBe('boolean');
  });

  // GPU path: only runs when the probe says we have a real CUDA stack AND
  // a model is on disk. Generates a 3 s synthetic WAV (small enough that
  // even the largest model finishes in seconds), runs it through whisper.cpp
  // with gpu=null (let the binary's GPU default decide), and verifies the
  // result echoes the GPU intent back.
  gpuItIf('runs a real synthetic WAV through whisper.cpp on the GPU path', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-gpu-int-'));
    try {
      const wav = path.join(tmpdir, 'sample.wav');
      generateBenchWav(wav, { durationSeconds: 3 });
      const result = await transcribeFile({
        wav,
        model: modelPath,
        gpu: null,
        spawnFn: spawn,
      });
      expect(result).toEqual(expect.objectContaining({
        text: expect.any(String),
        gpu: null,
        gpuLayers: null,
      }));
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 60_000);

  // --no-gpu override smoke: same path, but forces CPU. This is the
  // diagnostic for "did our flag plumbing from GPU-2 actually land in the
  // process argv?" -- if the binary respects it the run is slower; if not
  // we'd see GPU speed and the GPU path test above succeeding tells us
  // nothing about CPU forcing.
  gpuItIf('respects --no-gpu and returns gpu:false in the result', async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-gpu-int-cpu-'));
    try {
      const wav = path.join(tmpdir, 'sample.wav');
      generateBenchWav(wav, { durationSeconds: 3 });
      const result = await transcribeFile({
        wav,
        model: modelPath,
        gpu: false,
        spawnFn: spawn,
      });
      expect(result.gpu).toBe(false);
      expect(typeof result.text).toBe('string');
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  }, 60_000);
});
