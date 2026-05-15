const {
  formatChunkMarkdown,
  markdownPathFor,
  formatNumberWithSeparator,
  formatDurationSeconds,
  formatPeak,
  formatAcceleratorLabel,
  parseChunkTimestamp,
} = require('../src/chunkMarkdown');

const path = require('path');

// Realistic sidecar fixture matching what writeSidecar produces.
function sampleSidecar(overrides = {}) {
  return {
    version: 1,
    wav: 'chunk-20260512-162301-489.wav',
    start: '2026-05-12T21:23:01.490Z',
    end: '2026-05-12T21:23:13.523Z',
    durationMs: 11519,
    audio: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      encoding: 'signed-integer',
    },
    peak: 0.5634765625,
    peakDb: -4.9824828696816095,
    bytes: 368640,
    ...overrides,
  };
}

describe('formatNumberWithSeparator', () => {
  test('inserts spaces every 3 digits from the right', () => {
    expect(formatNumberWithSeparator(368640)).toBe('368 640');
    expect(formatNumberWithSeparator(1)).toBe('1');
    expect(formatNumberWithSeparator(999)).toBe('999');
    expect(formatNumberWithSeparator(1000)).toBe('1 000');
    expect(formatNumberWithSeparator(1234567)).toBe('1 234 567');
  });

  test('rounds to integer (bytes are never fractional)', () => {
    expect(formatNumberWithSeparator(1234.7)).toBe('1 235');
  });

  test('passes through non-finite gracefully', () => {
    expect(formatNumberWithSeparator(NaN)).toBe('NaN');
    expect(formatNumberWithSeparator(undefined)).toBe('undefined');
  });
});

describe('formatDurationSeconds', () => {
  test('<10s renders to 2 decimal places', () => {
    expect(formatDurationSeconds(0)).toBe('0.00 s');
    expect(formatDurationSeconds(1500)).toBe('1.50 s');
    // Boundary: 9999ms = 9.999s. The <10s rule applies (raw value), but
    // toFixed(2) rounds up to "10.00 s". That's a quirk of the boundary;
    // values >=10000ms enter the 1-decimal branch.
    expect(formatDurationSeconds(9999)).toBe('10.00 s');
    expect(formatDurationSeconds(10000)).toBe('10.0 s');
  });

  test('10s..60s renders to 1 decimal place', () => {
    expect(formatDurationSeconds(11519)).toBe('11.5 s');
    expect(formatDurationSeconds(59999)).toBe('60.0 s'); // boundary, still seconds form
  });

  test('>=60s renders as Xm Ys', () => {
    expect(formatDurationSeconds(60000)).toBe('1m 0.0s');
    expect(formatDurationSeconds(125000)).toBe('2m 5.0s');
    expect(formatDurationSeconds(3661500)).toBe('61m 1.5s');
  });

  test('non-finite or negative falls back to "unknown"', () => {
    expect(formatDurationSeconds(NaN)).toBe('unknown');
    expect(formatDurationSeconds(-1)).toBe('unknown');
    expect(formatDurationSeconds(undefined)).toBe('unknown');
  });
});

describe('formatPeak', () => {
  test('renders dBFS with two decimals and the linear peak in parens', () => {
    expect(formatPeak(-4.9824828696816095, 0.5634765625)).toBe('-4.98 dBFS (0.563)');
  });

  test('uses ASCII minus, not Unicode', () => {
    expect(formatPeak(-6, 0.5)).toMatch(/^-/);
    expect(formatPeak(-6, 0.5)).not.toMatch(/\u2212/);
  });

  test('positive dB (clipping) renders without a minus sign', () => {
    expect(formatPeak(0.5, 1.05)).toBe('0.50 dBFS (1.050)');
  });

  test('null/missing peak omits the parenthesised linear value', () => {
    expect(formatPeak(-12.3, undefined)).toBe('-12.30 dBFS');
    expect(formatPeak(-12.3, null)).toBe('-12.30 dBFS');
  });

  test('non-finite dB falls back to "unknown dBFS"', () => {
    expect(formatPeak(NaN, 0.5)).toBe('unknown dBFS (0.500)');
    expect(formatPeak(undefined, undefined)).toBe('unknown dBFS');
  });
});

describe('parseChunkTimestamp', () => {
  test('parses the canonical chunk-YYYYMMDD-HHMMSS-mmm stem', () => {
    expect(parseChunkTimestamp('chunk-20260512-162301-489')).toEqual({
      isoLocal: '2026-05-12 16:23:01.489',
      duplicate: null,
    });
  });

  test('parses duplicate-disambiguation suffix (-N)', () => {
    expect(parseChunkTimestamp('chunk-20260512-162301-489-2')).toEqual({
      isoLocal: '2026-05-12 16:23:01.489',
      duplicate: 2,
    });
  });

  test('returns null for non-chunk basenames', () => {
    expect(parseChunkTimestamp('hello')).toBeNull();
    expect(parseChunkTimestamp('chunk-2026')).toBeNull();
    expect(parseChunkTimestamp('recording-20260512-162301')).toBeNull();
  });
});

describe('markdownPathFor', () => {
  test('replaces .wav with .md and preserves the directory', () => {
    const wav = path.join('recordings', 'meeting', 'chunk-A.wav');
    const md = path.join('recordings', 'meeting', 'chunk-A.md');
    expect(markdownPathFor(wav)).toBe(md);
  });

  test('handles uppercase .WAV', () => {
    expect(markdownPathFor('foo.WAV')).toBe(`foo.md`);
  });
});

describe('formatChunkMarkdown (happy path)', () => {
  test('renders heading + metadata + file links + transcript when transcribeStatus="ok"', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcript: 'Hello world.\nThis is a test.',
      transcribeStatus: 'ok',
    });
    // Heading line, human-readable timestamp + stem
    expect(md).toMatch(/^# Chunk 2026-05-12 16:23:01\.489 \(chunk-20260512-162301-489\)/);
    // Metadata key/value pairs
    expect(md).toContain('**Duration:** 11.5 s');
    expect(md).toContain('**Peak:** -4.98 dBFS (0.563)');
    expect(md).toContain('**Bytes:** 368 640');
    expect(md).toContain('**Start:** 2026-05-12T21:23:01.490Z');
    expect(md).toContain('**End:**   2026-05-12T21:23:13.523Z');
    // File links
    expect(md).toContain('[chunk-20260512-162301-489.wav](chunk-20260512-162301-489.wav)');
    expect(md).toContain('[chunk-20260512-162301-489.json](chunk-20260512-162301-489.json)');
    expect(md).toContain('[chunk-20260512-162301-489.txt](chunk-20260512-162301-489.txt)');
    // Transcript section
    expect(md).toContain('## Transcript\n\nHello world.\nThis is a test.');
    // Trailing newline (POSIX-friendly)
    expect(md.endsWith('\n')).toBe(true);
  });

  test('default heading uses fixed text when basename does not match chunk-...', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar({ wav: 'arbitrary.wav' }),
      transcribeStatus: 'ok',
      transcript: 'x',
    });
    expect(md.split('\n')[0]).toBe('# Chunk arbitrary');
  });

  test('duplicate-suffix chunk renders "#N" disambiguator in the heading', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar({ wav: 'chunk-20260512-162301-489-3.wav' }),
      transcribeStatus: 'ok',
      transcript: 'x',
    });
    expect(md.split('\n')[0]).toBe('# Chunk 2026-05-12 16:23:01.489 #3 (chunk-20260512-162301-489-3)');
  });
});

describe('formatChunkMarkdown (failure / empty / pending paths)', () => {
  test('transcribeStatus="failed" includes the error message in italics', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'failed',
      transcribeError: 'whisper-cli exited with code 1',
    });
    expect(md).toContain('## Transcript\n\n_Transcription unavailable: whisper-cli exited with code 1_');
    // No .txt link when transcription failed
    expect(md).not.toContain('chunk-20260512-162301-489.txt');
  });

  test('transcribeStatus="failed" without an explicit error message falls back to "unknown error"', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'failed',
    });
    expect(md).toContain('_Transcription unavailable: unknown error_');
  });

  test('transcribeStatus="ok" with empty/whitespace transcript renders an empty-speech stub', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'ok',
      transcript: '   \n  \n',
    });
    expect(md).toContain('## Transcript\n\n_No speech detected (whisper.cpp returned an empty transcript)._');
    // No .txt link when transcript is empty (the .txt is on disk but empty,
    // so linking to it would be misleading; we omit unless caller passes txtBasename).
    expect(md).not.toContain('chunk-20260512-162301-489.txt');
  });

  test('transcribeStatus="pending" renders the "not attempted" stub', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'pending',
    });
    expect(md).toContain('## Transcript\n\n_Transcription not attempted._');
  });

  test('transcribeStatus="skipped" surfaces the reason', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar({ peak: 0.001, peakDb: -60 }),
      transcribeStatus: 'skipped',
      transcribeError: 'peak below threshold (peak=0.001 < min=0.005)',
    });
    expect(md).toContain('_Skipped: peak below threshold (peak=0.001 < min=0.005)_');
  });

  test('explicit txtBasename is included as a link even when transcribeStatus is non-ok', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'failed',
      transcribeError: 'simulated',
      txtBasename: 'chunk-20260512-162301-489.txt',
    });
    expect(md).toContain('[chunk-20260512-162301-489.txt](chunk-20260512-162301-489.txt)');
  });
});

describe('formatAcceleratorLabel (GPU-2)', () => {
  test('returns "GPU" when gpu: true with no layer override', () => {
    expect(formatAcceleratorLabel({ gpu: true })).toBe('GPU');
  });

  test('returns "GPU (N layers)" when gpuLayers is set', () => {
    expect(formatAcceleratorLabel({ gpu: true, gpuLayers: 32 })).toBe('GPU (32 layers)');
  });

  test('returns "CPU (forced)" when gpu: false', () => {
    expect(formatAcceleratorLabel({ gpu: false })).toBe('CPU (forced)');
  });

  test('returns null when no transcribe block', () => {
    expect(formatAcceleratorLabel(null)).toBeNull();
    expect(formatAcceleratorLabel(undefined)).toBeNull();
    expect(formatAcceleratorLabel('not-an-object')).toBeNull();
  });

  test('returns null when gpu is the tri-state "let whisper decide" (null)', () => {
    expect(formatAcceleratorLabel({ gpu: null })).toBeNull();
    expect(formatAcceleratorLabel({})).toBeNull();
  });
});

describe('formatChunkMarkdown (GPU-2 accelerator line)', () => {
  test('adds an **Accelerator:** line when sidecar.transcribe.gpu is true', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar({
        transcribe: { model: 'm.bin', language: null, gpu: true, gpuLayers: 32 },
      }),
      transcribeStatus: 'ok',
      transcript: 'hi',
    });
    expect(md).toContain('**Accelerator:** GPU (32 layers)');
  });

  test('shows "CPU (forced)" when --no-gpu was set', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar({
        transcribe: { model: 'm.bin', language: null, gpu: false, gpuLayers: null },
      }),
      transcribeStatus: 'ok',
      transcript: 'hi',
    });
    expect(md).toContain('**Accelerator:** CPU (forced)');
  });

  test('omits the accelerator line when the sidecar has no transcribe block', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'ok',
      transcript: 'hi',
    });
    expect(md).not.toContain('**Accelerator:**');
  });

  test('omits the accelerator line when gpu is null ("whisper.cpp default")', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar({
        transcribe: { model: 'm.bin', language: null, gpu: null, gpuLayers: null },
      }),
      transcribeStatus: 'ok',
      transcript: 'hi',
    });
    expect(md).not.toContain('**Accelerator:**');
  });
});

describe('formatChunkMarkdown (argument validation)', () => {
  test('throws when sidecar is missing', () => {
    expect(() => formatChunkMarkdown({})).toThrow(/sidecar is required/);
    expect(() => formatChunkMarkdown()).toThrow(/sidecar is required/);
  });

  test('throws when sidecar is not an object', () => {
    expect(() => formatChunkMarkdown({ sidecar: 'oops' })).toThrow(/sidecar is required/);
    expect(() => formatChunkMarkdown({ sidecar: 42 })).toThrow(/sidecar is required/);
  });

  test('tolerates a sidecar missing optional fields (bytes / start / end)', () => {
    const minimal = { wav: 'chunk-X.wav', durationMs: 1000, peak: 0.1, peakDb: -20 };
    const md = formatChunkMarkdown({
      sidecar: minimal,
      transcribeStatus: 'pending',
    });
    expect(md).toContain('# Chunk chunk-X');
    expect(md).toContain('**Duration:** 1.00 s');
    expect(md).toContain('**Peak:** -20.00 dBFS (0.100)');
    expect(md).not.toContain('**Bytes:**');
    expect(md).not.toContain('**Start:**');
    expect(md).not.toContain('**End:**');
  });
});

describe('formatChunkMarkdown (markdown structural sanity)', () => {
  test('exactly one H1 at the top', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'ok',
      transcript: 'one\ntwo',
    });
    const h1Count = (md.match(/^# /gm) || []).length;
    expect(h1Count).toBe(1);
    expect(md.split('\n')[0].startsWith('# ')).toBe(true);
  });

  test('exactly one ## Transcript heading', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'ok',
      transcript: 'hi',
    });
    const h2Count = (md.match(/^## /gm) || []).length;
    expect(h2Count).toBe(1);
  });

  test('no unbalanced code fences (we never open one)', () => {
    const md = formatChunkMarkdown({
      sidecar: sampleSidecar(),
      transcribeStatus: 'ok',
      transcript: 'Hello, with `inline code` and *emphasis*.',
    });
    const fences = (md.match(/^```/gm) || []).length;
    expect(fences).toBe(0);
  });
});
