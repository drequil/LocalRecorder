// GPU-2: resolveGpuFlags collapses the CLI surface (--no-gpu, --gpu-layers N)
// into the {gpu, gpuLayers} tri-state that the rest of the pipeline consumes.
const { resolveGpuFlags } = require('../src/index');

describe('resolveGpuFlags', () => {
  test('returns the "let whisper.cpp decide" shape when nothing is set', () => {
    expect(resolveGpuFlags({})).toEqual({ gpu: null, gpuLayers: null });
    expect(resolveGpuFlags({ noGpu: false, gpuLayers: null })).toEqual({ gpu: null, gpuLayers: null });
  });

  test('treats --no-gpu as hard CPU (gpu: false, layers cleared)', () => {
    expect(resolveGpuFlags({ noGpu: true })).toEqual({ gpu: false, gpuLayers: null });
  });

  test('treats --gpu-layers N as gpu: true + layers: N', () => {
    expect(resolveGpuFlags({ gpuLayers: 32 })).toEqual({ gpu: true, gpuLayers: 32 });
    expect(resolveGpuFlags({ gpuLayers: 99 })).toEqual({ gpu: true, gpuLayers: 99 });
  });

  test('rejects combining --no-gpu with --gpu-layers', () => {
    const r = resolveGpuFlags({ noGpu: true, gpuLayers: 32 });
    expect(r.error).toMatch(/cannot use --no-gpu together with --gpu-layers/);
  });

  test('ignores non-positive / non-integer gpuLayers (CLI parser already rejects, but be defensive)', () => {
    expect(resolveGpuFlags({ gpuLayers: 0 })).toEqual({ gpu: null, gpuLayers: null });
    expect(resolveGpuFlags({ gpuLayers: -1 })).toEqual({ gpu: null, gpuLayers: null });
    expect(resolveGpuFlags({ gpuLayers: 12.5 })).toEqual({ gpu: null, gpuLayers: null });
  });
});
