const os = require('os');
const {
  resolveTranscribeThreads, WHISPER_MAX_AUTO_THREADS,
  resolveNoSpeechThreshold, resolveEntropyThreshold,
  WHISPER_NO_SPEECH_DEFAULT, WHISPER_ENTROPY_DEFAULT,
} = require('../src/index');

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

describe('resolveNoSpeechThreshold', () => {
  test('returns explicit value when valid', () => {
    expect(resolveNoSpeechThreshold(0.6)).toBe(0.6);
    expect(resolveNoSpeechThreshold(0)).toBe(0);
    expect(resolveNoSpeechThreshold(1.0)).toBe(1.0);
  });

  test('returns default when null/undefined', () => {
    expect(resolveNoSpeechThreshold(null)).toBe(WHISPER_NO_SPEECH_DEFAULT);
    expect(resolveNoSpeechThreshold(undefined)).toBe(WHISPER_NO_SPEECH_DEFAULT);
  });

  test('default is 0.8', () => {
    expect(WHISPER_NO_SPEECH_DEFAULT).toBe(0.8);
  });
});

describe('resolveEntropyThreshold', () => {
  test('returns explicit value when valid', () => {
    expect(resolveEntropyThreshold(2.4)).toBe(2.4);
    expect(resolveEntropyThreshold(3.5)).toBe(3.5);
  });

  test('returns default when null/undefined', () => {
    expect(resolveEntropyThreshold(null)).toBe(WHISPER_ENTROPY_DEFAULT);
    expect(resolveEntropyThreshold(undefined)).toBe(WHISPER_ENTROPY_DEFAULT);
  });

  test('default is 2.8', () => {
    expect(WHISPER_ENTROPY_DEFAULT).toBe(2.8);
  });
});
