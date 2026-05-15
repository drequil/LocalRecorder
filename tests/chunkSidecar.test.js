const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SIDECAR_SCHEMA_VERSION,
  sidecarPathFor,
  audioDurationMs,
  buildSidecar,
  writeSidecar,
} = require('../src/chunkSidecar');

describe('sidecarPathFor', () => {
  test('replaces the wav extension with json next to the original file', () => {
    const wav = path.join('recordings', 'chunk-20260512-082345-123.wav');
    expect(sidecarPathFor(wav)).toBe(path.join('recordings', 'chunk-20260512-082345-123.json'));
  });
});

describe('audioDurationMs', () => {
  test('returns audio length in ms from header offset, sample rate, channels, bit depth', () => {
    const ms = audioDurationMs({
      fileSize: 32044, // 32000 audio bytes + 44 header
      dataPayloadOffset: 44,
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    });
    expect(ms).toBe(1000); // 32000 bytes / 2 bytes per sample / 16000 = 1s
  });

  test('handles stereo 24-bit math', () => {
    const ms = audioDurationMs({
      fileSize: 44 + 48000 * 2 * 3, // 1s at 48k stereo 24-bit
      dataPayloadOffset: 44,
      sampleRate: 48000,
      channels: 2,
      bitDepth: 24,
    });
    expect(ms).toBe(1000);
  });

  test('returns 0 when fileSize <= dataPayloadOffset', () => {
    expect(audioDurationMs({ fileSize: 44, dataPayloadOffset: 44, sampleRate: 16000, channels: 1, bitDepth: 16 })).toBe(0);
    expect(audioDurationMs({ fileSize: 10, dataPayloadOffset: 44, sampleRate: 16000, channels: 1, bitDepth: 16 })).toBe(0);
  });

  test('returns 0 on invalid sample rate or channels', () => {
    expect(audioDurationMs({ fileSize: 1000, dataPayloadOffset: 44, sampleRate: 0, channels: 1, bitDepth: 16 })).toBe(0);
    expect(audioDurationMs({ fileSize: 1000, dataPayloadOffset: 44, sampleRate: 16000, channels: 0, bitDepth: 16 })).toBe(0);
  });
});

describe('buildSidecar', () => {
  test('produces a schema-v1 object with all expected fields', () => {
    const start = new Date('2026-05-12T13:23:45.123Z');
    const end = new Date('2026-05-12T13:23:46.123Z');
    const result = buildSidecar({
      wavPath: '/tmp/recordings/chunk-20260512-082345-123.wav',
      start,
      end,
      fileSize: 32044,
      dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0.234,
      peakDb: -12.6,
    });
    expect(result).toEqual({
      version: SIDECAR_SCHEMA_VERSION,
      wav: 'chunk-20260512-082345-123.wav',
      start: '2026-05-12T13:23:45.123Z',
      end: '2026-05-12T13:23:46.123Z',
      durationMs: 1000,
      audio: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0.234,
      peakDb: -12.6,
      bytes: 32044,
    });
  });

  test('accepts ISO strings for start/end without re-stringifying', () => {
    const result = buildSidecar({
      wavPath: '/tmp/x.wav',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:01.000Z',
      fileSize: 100,
      dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0,
      peakDb: -120,
    });
    expect(result.start).toBe('2026-01-01T00:00:00.000Z');
    expect(result.end).toBe('2026-01-01T00:00:01.000Z');
  });

  // GPU-2 ------------------------------------------------------------------
  test('GPU-2: schema is bumped to v2', () => {
    expect(SIDECAR_SCHEMA_VERSION).toBe(2);
  });

  test('GPU-2: omits the transcribe block when no transcribe arg is passed', () => {
    const result = buildSidecar({
      wavPath: '/tmp/x.wav',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:01.000Z',
      fileSize: 100, dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0, peakDb: -120,
    });
    expect(result.transcribe).toBeUndefined();
  });

  test('GPU-2: includes the transcribe block when capture intent is supplied', () => {
    const result = buildSidecar({
      wavPath: '/tmp/x.wav',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:01.000Z',
      fileSize: 100, dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0, peakDb: -120,
      transcribe: { model: 'models/ggml-large-v3.bin', language: 'en', gpu: true, gpuLayers: 32 },
    });
    expect(result.transcribe).toEqual({
      model: 'models/ggml-large-v3.bin',
      language: 'en',
      gpu: true,
      gpuLayers: 32,
    });
  });

  test('GPU-2: normalises tri-state and rejects bad gpuLayers', () => {
    const r1 = buildSidecar({
      wavPath: '/tmp/x.wav', start: 's', end: 'e',
      fileSize: 100, dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0, peakDb: 0,
      transcribe: { model: 'm.bin', language: null, gpu: 'yes', gpuLayers: 'lots' },
    });
    // Anything that isn't strictly true/false collapses to null; bad layers cleared.
    expect(r1.transcribe).toEqual({ model: 'm.bin', language: null, gpu: null, gpuLayers: null });

    const r2 = buildSidecar({
      wavPath: '/tmp/x.wav', start: 's', end: 'e',
      fileSize: 100, dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0, peakDb: 0,
      transcribe: { model: 'm.bin', language: '  ', gpu: false, gpuLayers: 32 },
    });
    // gpu: false → layers always null regardless of input.
    expect(r2.transcribe).toEqual({ model: 'm.bin', language: null, gpu: false, gpuLayers: null });
  });
});

describe('writeSidecar (real fs round-trip)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  test('writes pretty JSON next to the wav and returns the json path', () => {
    const wavPath = path.join(tmpDir, 'chunk-1.wav');
    fs.writeFileSync(wavPath, Buffer.alloc(100));
    const payload = buildSidecar({
      wavPath,
      start: new Date('2026-05-12T13:23:45.123Z'),
      end: new Date('2026-05-12T13:23:46.123Z'),
      fileSize: 100,
      dataPayloadOffset: 44,
      format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0.5,
      peakDb: -6.0,
    });
    const jsonPath = writeSidecar(wavPath, payload);
    expect(jsonPath).toBe(path.join(tmpDir, 'chunk-1.json'));
    const roundtrip = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(roundtrip).toEqual(payload);
  });
});
