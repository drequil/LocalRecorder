const path = require('path');
const { parsePresetFlags, resolvePresetModelAbs, defaultMultilingualBasename } = require('../src/whisperModelPreset');

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
