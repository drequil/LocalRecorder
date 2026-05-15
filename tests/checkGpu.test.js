const {
  CUDA_HELP_TOKENS,
  runNvidiaSmi,
  inspectWhisperBuild,
  detectGpu,
  printHumanSummary,
} = require('../tools/check-gpu');

describe('CUDA_HELP_TOKENS', () => {
  test('covers the strings whisper.cpp only prints from CUDA builds', () => {
    // We OR these, so each one is sufficient on its own; the test pins the
    // current set so a help-text rewrite that drops e.g. `--no-gpu` is noticed.
    expect(CUDA_HELP_TOKENS).toEqual(expect.arrayContaining([
      '--no-gpu', '-ngl', '--n-gpu-layers', 'cublas', 'CUDA', 'use gpu',
    ]));
  });
});

describe('runNvidiaSmi', () => {
  test('parses a single-device CSV row', () => {
    const fakeRunner = () => ({
      status: 0,
      stdout: 'NVIDIA GeForce RTX 4080 Ti, 16376, 552.22\n',
      stderr: '',
    });
    const out = runNvidiaSmi({ runner: fakeRunner });
    expect(out.available).toBe(true);
    expect(out.vendor).toBe('nvidia');
    expect(out.devices).toEqual([
      { name: 'NVIDIA GeForce RTX 4080 Ti', vramMb: 16376, driver: '552.22' },
    ]);
    expect(out.primary).toEqual(out.devices[0]);
  });

  test('parses multiple devices', () => {
    const fakeRunner = () => ({
      status: 0,
      stdout: 'RTX 4080 Ti, 16376, 552.22\nRTX 3090, 24576, 552.22\n',
      stderr: '',
    });
    const out = runNvidiaSmi({ runner: fakeRunner });
    expect(out.available).toBe(true);
    expect(out.devices).toHaveLength(2);
    expect(out.primary.name).toBe('RTX 4080 Ti');
  });

  test('reports unavailable when nvidia-smi is not installed', () => {
    const fakeRunner = () => ({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) });
    const out = runNvidiaSmi({ runner: fakeRunner });
    expect(out.available).toBe(false);
    expect(out.reason).toBe('ENOENT');
  });

  test('reports unavailable when nvidia-smi exits non-zero', () => {
    const fakeRunner = () => ({ status: 1, stdout: '', stderr: 'NVIDIA-SMI has failed because it couldn\'t communicate with the NVIDIA driver.\n' });
    const out = runNvidiaSmi({ runner: fakeRunner });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/NVIDIA-SMI/);
  });

  test('reports unavailable when no rows come back', () => {
    const fakeRunner = () => ({ status: 0, stdout: '\n\n', stderr: '' });
    const out = runNvidiaSmi({ runner: fakeRunner });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/no rows/);
  });

  test('handles VRAM = "N/A" gracefully', () => {
    const fakeRunner = () => ({ status: 0, stdout: 'Tesla T4, N/A, 535.86\n', stderr: '' });
    const out = runNvidiaSmi({ runner: fakeRunner });
    expect(out.available).toBe(true);
    expect(out.primary).toEqual({ name: 'Tesla T4', vramMb: null, driver: '535.86' });
  });
});

describe('inspectWhisperBuild', () => {
  function fakeProbeReturning(stdout) {
    return () => ({ ok: true, status: 0, stdout, stderr: '' });
  }

  test('flags a CUDA-built binary when -ngl appears in --help', () => {
    const probe = fakeProbeReturning(
      'usage: whisper-cli [options]\n  -ngl N, --n-gpu-layers N    number of layers to offload to GPU\n  --no-gpu                    disable GPU acceleration\n',
    );
    const out = inspectWhisperBuild({ probe, candidates: ['whisper-cli'] });
    expect(out.binary).toBe('whisper-cli');
    expect(out.cudaCapable).toBe(true);
    expect(out.sawFlags).toEqual(expect.arrayContaining(['-ngl', '--n-gpu-layers', '--no-gpu']));
    expect(out.reason).toBeNull();
  });

  test('flags CPU-only when help has none of the CUDA tokens', () => {
    const probe = fakeProbeReturning('usage: whisper-cli [options]\n  -t N    threads\n  -m FNAME    model\n');
    const out = inspectWhisperBuild({ probe, candidates: ['whisper-cli'] });
    expect(out.binary).toBe('whisper-cli');
    expect(out.cudaCapable).toBe(false);
    expect(out.sawFlags).toEqual([]);
    expect(out.reason).toMatch(/no CUDA flags/);
  });

  test('reports missing binary when probe never finds one', () => {
    const probe = () => ({ ok: false, error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) });
    const out = inspectWhisperBuild({ probe, candidates: ['whisper-cli'] });
    expect(out.binary).toBeNull();
    expect(out.cudaCapable).toBe(false);
    expect(out.reason).toMatch(/no whisper.cpp CLI on PATH/);
  });

  test('matches "cublas" in lowercase help text', () => {
    const probe = fakeProbeReturning('whisper-cli (cuBLAS build)\nusage: ...\n');
    const out = inspectWhisperBuild({ probe, candidates: ['whisper-cli'] });
    expect(out.cudaCapable).toBe(true);
    expect(out.sawFlags).toEqual(expect.arrayContaining(['cublas']));
  });
});

describe('detectGpu (composed)', () => {
  test('returns a real object even when nvidia-smi/binary are absent', () => {
    // We can't stub the internals from outside without DI, but the function
    // must never throw. Calling refresh=true bypasses the module cache.
    const out = detectGpu({ refresh: true });
    expect(out).toHaveProperty('gpu');
    expect(out).toHaveProperty('binary');
    expect(out).toHaveProperty('effective');
    expect(typeof out.effective).toBe('boolean');
  });
});

describe('printHumanSummary', () => {
  test('shows the AVAILABLE banner when both halves succeed', () => {
    const text = printHumanSummary({
      gpu: { available: true, primary: { name: 'RTX 4080 Ti', vramMb: 16376, driver: '552' }, devices: [{ name: 'RTX 4080 Ti' }] },
      binary: { binary: 'whisper-cli', binaryPath: 'C:\\tools\\whisper-cli.exe', cudaCapable: true, sawFlags: ['-ngl'], reason: null },
      effective: true,
    });
    expect(text).toMatch(/RTX 4080 Ti/);
    expect(text).toMatch(/AVAILABLE/);
    expect(text).toMatch(/--no-gpu/);
  });

  test('explains the "GPU present but CPU-only build" case', () => {
    const text = printHumanSummary({
      gpu: { available: true, primary: { name: 'RTX 4080 Ti', vramMb: 16376, driver: '552' }, devices: [{ name: 'RTX 4080 Ti' }] },
      binary: { binary: 'whisper-cli', binaryPath: 'C:\\tools\\whisper-cli.exe', cudaCapable: false, sawFlags: [], reason: 'help text shows no CUDA flags' },
      effective: false,
    });
    expect(text).toMatch(/CPU-only/);
    expect(text).toMatch(/gpu:install/);
  });

  test('falls back to the CPU baseline message when nothing is available', () => {
    const text = printHumanSummary({
      gpu: { available: false, reason: 'ENOENT' },
      binary: { binary: null, binaryPath: null, cudaCapable: false, sawFlags: [], reason: 'no whisper.cpp CLI on PATH' },
      effective: false,
    });
    expect(text).toMatch(/No GPU acceleration/);
    expect(text).toMatch(/CPU \(today's baseline\)/);
  });
});
