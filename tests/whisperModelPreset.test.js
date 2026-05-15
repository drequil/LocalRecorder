const path = require('path');
const {
  parsePresetFlags,
  resolvePresetModelAbs,
  defaultMultilingualBasename,
  resolveBestAvailableModel,
  resolveTinydiarizeModel,
  MODEL_PROBE_ORDER,
  TINYDIARIZE_MODEL_BASENAME,
} = require('../src/whisperModelPreset');

describe('parsePresetFlags', () => {
  test('returns null preset when neither flag', () => {
    expect(parsePresetFlags({})).toEqual({ transcribeModelPreset: null });
    expect(parsePresetFlags({ medium: false, large: false })).toEqual({ transcribeModelPreset: null });
  });

  test('maps --medium / --large', () => {
    expect(parsePresetFlags({ medium: true })).toEqual({ transcribeModelPreset: 'medium' });
    expect(parsePresetFlags({ large: true })).toEqual({ transcribeModelPreset: 'large' });
  });

  test('rejects both', () => {
    expect(parsePresetFlags({ medium: true, large: true }).error).toMatch(/cannot use --medium together/);
  });
});

describe('resolvePresetModelAbs', () => {
  test('resolves under cwd/models', () => {
    const cwd = 'D:/proj';
    expect(resolvePresetModelAbs(cwd, 'medium')).toBe(path.normalize(path.join(cwd, 'models', 'ggml-medium.bin')));
    expect(resolvePresetModelAbs(cwd, 'large')).toBe(path.normalize(path.join(cwd, 'models', 'ggml-large-v3.bin')));
  });

  test('returns null for unknown preset', () => {
    expect(resolvePresetModelAbs('D:/proj', null)).toBeNull();
  });
});

describe('defaultMultilingualBasename', () => {
  test('base fallback', () => {
    expect(defaultMultilingualBasename(null)).toBe('ggml-base.bin');
    expect(defaultMultilingualBasename(undefined)).toBe('ggml-base.bin');
  });
});

describe('resolveBestAvailableModel', () => {
  const cwd = 'D:/proj';

  function makeFsImpl(...existingBasenames) {
    const existing = new Set(
      existingBasenames.map((b) => path.normalize(path.resolve(cwd, 'models', b))),
    );
    return { existsSync: (p) => existing.has(path.normalize(p)) };
  }

  test('MODEL_PROBE_ORDER starts with large-v3 and ends with base.en', () => {
    expect(MODEL_PROBE_ORDER[0]).toBe('ggml-large-v3.bin');
    expect(MODEL_PROBE_ORDER).toContain('ggml-base.en.bin');
  });

  test('returns large-v3 when it exists', () => {
    const fsImpl = makeFsImpl('ggml-large-v3.bin', 'ggml-medium.bin', 'ggml-base.en.bin');
    expect(resolveBestAvailableModel(cwd, fsImpl)).toBe(
      path.normalize(path.resolve(cwd, 'models', 'ggml-large-v3.bin')),
    );
  });

  test('skips large-v3 and returns medium when only medium exists', () => {
    const fsImpl = makeFsImpl('ggml-medium.bin');
    expect(resolveBestAvailableModel(cwd, fsImpl)).toBe(
      path.normalize(path.resolve(cwd, 'models', 'ggml-medium.bin')),
    );
  });

  test('returns base.en when only base.en exists', () => {
    const fsImpl = makeFsImpl('ggml-base.en.bin');
    expect(resolveBestAvailableModel(cwd, fsImpl)).toBe(
      path.normalize(path.resolve(cwd, 'models', 'ggml-base.en.bin')),
    );
  });

  test('falls back to base.en path when nothing exists', () => {
    const fsImpl = makeFsImpl();
    expect(resolveBestAvailableModel(cwd, fsImpl)).toBe(
      path.normalize(path.resolve(cwd, 'models', 'ggml-base.en.bin')),
    );
  });
});

describe('resolveTinydiarizeModel', () => {
  const cwd = 'D:/proj';

  function makeFsImpl(...existingBasenames) {
    const existing = new Set(
      existingBasenames.map((b) => path.normalize(path.resolve(cwd, 'models', b))),
    );
    return { existsSync: (p) => existing.has(path.normalize(p)) };
  }

  test('returns small.en-tdrz when available', () => {
    expect(resolveTinydiarizeModel(cwd, makeFsImpl(TINYDIARIZE_MODEL_BASENAME))).toBe(
      path.normalize(path.resolve(cwd, 'models', TINYDIARIZE_MODEL_BASENAME)),
    );
  });

  test('returns null when small.en-tdrz is missing', () => {
    expect(resolveTinydiarizeModel(cwd, makeFsImpl('ggml-large-v3.bin'))).toBeNull();
  });
});
