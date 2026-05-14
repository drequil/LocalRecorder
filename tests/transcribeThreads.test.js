const os = require('os');
const { resolveTranscribeThreads, WHISPER_MAX_AUTO_THREADS } = require('../src/index');

describe('resolveTranscribeThreads', () => {
  test('returns an explicit positive integer value as-is', () => {
    expect(resolveTranscribeThreads(1)).toBe(1);
    expect(resolveTranscribeThreads(4)).toBe(4);
    expect(resolveTranscribeThreads(16)).toBe(16);
  });

  test('auto-default is min(cpus, WHISPER_MAX_AUTO_THREADS)', () => {
    const expected = Math.min(os.cpus().length, WHISPER_MAX_AUTO_THREADS);
    expect(resolveTranscribeThreads(null)).toBe(expected);
    expect(resolveTranscribeThreads(undefined)).toBe(expected);
    expect(resolveTranscribeThreads(0)).toBe(expected);
  });

  test('WHISPER_MAX_AUTO_THREADS is 8', () => {
    expect(WHISPER_MAX_AUTO_THREADS).toBe(8);
  });

  test('auto-default never exceeds 8', () => {
    expect(resolveTranscribeThreads(null)).toBeLessThanOrEqual(8);
  });
});
