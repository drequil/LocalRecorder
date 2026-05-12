const {
  appendChunkToSessionHtml,
  renderSessionDocumentInitial,
  renderChunkSectionHtml,
  spliceChunkSection,
  bumpChunkCount,
  transcriptHtmlPathFor,
  CHUNK_START_MARKER,
  CHUNK_END_MARKER,
  escapeHtml,
  formatBytes,
  formatDuration,
  formatPeakDb,
} = require('../src/sessionTranscript');

const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

function sampleSidecar(overrides = {}) {
  return {
    version: 1,
    wav: 'chunk-20260512-162301-489.wav',
    start: '2026-05-12T21:23:01.490Z',
    end: '2026-05-12T21:23:13.523Z',
    durationMs: 11519,
    audio: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
    peak: 0.563,
    peakDb: -4.98,
    bytes: 368640,
    ...overrides,
  };
}

describe('format helpers', () => {
  test('escapeHtml escapes the five entity-class characters', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  test('formatBytes uses B / KB / MB units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(368640)).toBe('360 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  test('formatDuration switches to "Xm Ys" past 60 s', () => {
    expect(formatDuration(0)).toBe('0.0 s');
    expect(formatDuration(11519)).toBe('11.5 s');
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  test('formatPeakDb uses ASCII minus and one decimal', () => {
    expect(formatPeakDb(-4.98)).toBe('-5.0 dBFS');
    expect(formatPeakDb(0)).toBe('0.0 dBFS');
    expect(formatPeakDb(NaN)).toBe('');
  });
});

describe('renderSessionDocumentInitial', () => {
  test('contains both chunk markers exactly once each', () => {
    const html = renderSessionDocumentInitial({
      sessionLabel: 'MeetingTest',
      startedAt: new Date('2026-05-12T22:00:00Z'),
    });
    const startCount = (html.match(/<!-- CHUNKS:START -->/g) || []).length;
    const endCount = (html.match(/<!-- CHUNKS:END -->/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  test('escapes the session label so injection is impossible', () => {
    const html = renderSessionDocumentInitial({
      sessionLabel: '<script>alert(1)</script>',
      startedAt: new Date('2026-05-12T22:00:00Z'),
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert');
  });

  test('includes the iso start time in the meta line', () => {
    const html = renderSessionDocumentInitial({
      sessionLabel: 'x',
      startedAt: new Date('2026-05-12T22:00:00Z'),
    });
    expect(html).toContain('2026-05-12T22:00:00.000Z');
  });

  test('initial chunk count is 0 inside the COUNT markers', () => {
    const html = renderSessionDocumentInitial({ sessionLabel: 'x' });
    expect(html).toMatch(/<!-- COUNT:START -->0<!-- COUNT:END -->/);
  });
});

describe('renderChunkSectionHtml', () => {
  test('"ok" status with non-empty transcript renders as the .chunk.ok class with the transcript escaped', () => {
    const html = renderChunkSectionHtml({
      sidecar: sampleSidecar(),
      transcript: 'Hello & welcome to the <meeting>.',
      transcribeStatus: 'ok',
    });
    expect(html).toContain('class="chunk ok"');
    expect(html).toContain('16:23:01'); // hh:mm:ss from filename
    expect(html).toContain('Hello &amp; welcome to the &lt;meeting&gt;.');
    // Should NOT contain the literal unescaped '<meeting>' tag-looking content
    expect(html).not.toContain('<meeting>');
  });

  test('"ok" status with empty transcript renders the "No speech detected" stub', () => {
    const html = renderChunkSectionHtml({
      sidecar: sampleSidecar(),
      transcript: '   \n  ',
      transcribeStatus: 'ok',
    });
    expect(html).toContain('class="stub">No speech detected.');
  });

  test('"skipped" status surfaces the reason inside a .chunk.skipped section', () => {
    const html = renderChunkSectionHtml({
      sidecar: sampleSidecar(),
      transcribeStatus: 'skipped',
      transcribeError: 'peak 0.001 below threshold',
    });
    expect(html).toContain('class="chunk skipped"');
    expect(html).toContain('Skipped: peak 0.001 below threshold');
  });

  test('"failed" status renders inside a .chunk.failed section with the error escaped', () => {
    const html = renderChunkSectionHtml({
      sidecar: sampleSidecar(),
      transcribeStatus: 'failed',
      transcribeError: 'whisper-cli exited with code 1 <bad>',
    });
    expect(html).toContain('class="chunk failed"');
    expect(html).toContain('Transcription failed: whisper-cli exited with code 1 &lt;bad&gt;');
  });

  test('heading shows compact duration | peak | bytes (pipe-separated, ASCII-safe)', () => {
    const html = renderChunkSectionHtml({
      sidecar: sampleSidecar(),
      transcript: 'x',
      transcribeStatus: 'ok',
    });
    expect(html).toContain('11.5 s');
    expect(html).toContain('-5.0 dBFS');
    expect(html).toContain('360 KB');
    expect(html).toContain('11.5 s | -5.0 dBFS | 360 KB');
  });

  test('throws on missing sidecar', () => {
    expect(() => renderChunkSectionHtml({ transcribeStatus: 'ok' }))
      .toThrow(/sidecar is required/);
  });
});

describe('spliceChunkSection', () => {
  test('inserts the new section before CHUNK_END_MARKER', () => {
    const base = renderSessionDocumentInitial({ sessionLabel: 'x', startedAt: new Date('2026-05-12T22:00:00Z') });
    const section = '<section class="chunk ok">FIRST</section>';
    const updated = spliceChunkSection(base, section);
    const firstIdx = updated.indexOf('FIRST');
    const markerIdx = updated.lastIndexOf(CHUNK_END_MARKER);
    expect(firstIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(markerIdx);
  });

  test('multiple splices preserve insertion order (earlier sections appear higher)', () => {
    const base = renderSessionDocumentInitial({ sessionLabel: 'x', startedAt: new Date('2026-05-12T22:00:00Z') });
    const a = '<section class="chunk ok">FIRST</section>';
    const b = '<section class="chunk ok">SECOND</section>';
    const after = spliceChunkSection(spliceChunkSection(base, a), b);
    const firstIdx = after.indexOf('FIRST');
    const secondIdx = after.indexOf('SECOND');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  test('falls back to appending when marker is missing (corrupt-doc recovery)', () => {
    const noMarker = '<!doctype html><body>no marker here</body></html>';
    const updated = spliceChunkSection(noMarker, '<section>X</section>');
    expect(updated).toContain('<section>X</section>');
    // No throw, no data loss.
    expect(updated).toContain('no marker here');
  });
});

describe('bumpChunkCount', () => {
  test('increments the count between the COUNT markers', () => {
    const initial = renderSessionDocumentInitial({ sessionLabel: 'x', startedAt: new Date('2026-05-12T22:00:00Z') });
    expect(initial).toMatch(/<!-- COUNT:START -->0<!-- COUNT:END -->/);
    const once = bumpChunkCount(initial);
    expect(once).toMatch(/<!-- COUNT:START -->1<!-- COUNT:END -->/);
    const twice = bumpChunkCount(once);
    expect(twice).toMatch(/<!-- COUNT:START -->2<!-- COUNT:END -->/);
  });

  test('returns the doc unchanged when the count markers are missing (cosmetic-only)', () => {
    const before = '<html><body>no count markers</body></html>';
    expect(bumpChunkCount(before)).toBe(before);
  });
});

describe('appendChunkToSessionHtml (integration)', () => {
  let tmpdir;
  beforeEach(() => {
    tmpdir = realFs.mkdtempSync(path.join(os.tmpdir(), 'lr-session-html-'));
  });
  afterEach(() => {
    realFs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('creates transcript.html on first append and grows on subsequent appends', () => {
    const wavA = path.join(tmpdir, 'chunk-20260512-162301-489.wav');
    const wavB = path.join(tmpdir, 'chunk-20260512-162320-100.wav');
    realFs.writeFileSync(wavA, '');
    realFs.writeFileSync(wavB, '');

    const htmlPathA = appendChunkToSessionHtml({
      wav: wavA,
      sidecar: sampleSidecar({ wav: 'chunk-20260512-162301-489.wav' }),
      transcript: 'First chunk transcript.',
      transcribeStatus: 'ok',
      fsImpl: realFs,
    });
    expect(htmlPathA).toBe(path.join(tmpdir, 'transcript.html'));
    expect(realFs.existsSync(htmlPathA)).toBe(true);
    const after1 = realFs.readFileSync(htmlPathA, 'utf8');
    expect(after1).toContain('First chunk transcript.');
    expect(after1).toMatch(/<!-- COUNT:START -->1<!-- COUNT:END -->/);

    const htmlPathB = appendChunkToSessionHtml({
      wav: wavB,
      sidecar: sampleSidecar({ wav: 'chunk-20260512-162320-100.wav' }),
      transcript: 'Second chunk transcript.',
      transcribeStatus: 'ok',
      fsImpl: realFs,
    });
    expect(htmlPathB).toBe(htmlPathA); // same file
    const after2 = realFs.readFileSync(htmlPathB, 'utf8');
    expect(after2).toContain('First chunk transcript.');
    expect(after2).toContain('Second chunk transcript.');
    expect(after2).toMatch(/<!-- COUNT:START -->2<!-- COUNT:END -->/);
    // First chunk must appear before the second (insertion order preserved).
    expect(after2.indexOf('First chunk transcript.'))
      .toBeLessThan(after2.indexOf('Second chunk transcript.'));
  });

  test('uses session directory basename as the default label', () => {
    const sessionDir = path.join(tmpdir, 'MeetingTest');
    realFs.mkdirSync(sessionDir);
    const wav = path.join(sessionDir, 'chunk-X.wav');
    realFs.writeFileSync(wav, '');

    appendChunkToSessionHtml({
      wav,
      sidecar: { wav: 'chunk-X.wav' },
      transcript: 'hi',
      transcribeStatus: 'ok',
      fsImpl: realFs,
    });
    const html = realFs.readFileSync(path.join(sessionDir, 'transcript.html'), 'utf8');
    expect(html).toContain('<title>MeetingTest &mdash; LocalRecorder transcript</title>');
    expect(html).toContain('<h1>MeetingTest</h1>');
  });

  test('mixes ok / skipped / failed entries in the same document', () => {
    const wav1 = path.join(tmpdir, 'a.wav');
    const wav2 = path.join(tmpdir, 'b.wav');
    const wav3 = path.join(tmpdir, 'c.wav');
    [wav1, wav2, wav3].forEach((p) => realFs.writeFileSync(p, ''));

    appendChunkToSessionHtml({
      wav: wav1, sidecar: { wav: 'a.wav', durationMs: 1000, peakDb: -10, bytes: 1000 },
      transcript: 'real text', transcribeStatus: 'ok', fsImpl: realFs,
    });
    appendChunkToSessionHtml({
      wav: wav2, sidecar: { wav: 'b.wav', durationMs: 1000, peakDb: -40, bytes: 500 },
      transcribeStatus: 'skipped', transcribeError: 'too quiet', fsImpl: realFs,
    });
    appendChunkToSessionHtml({
      wav: wav3, sidecar: { wav: 'c.wav', durationMs: 1000, peakDb: -5, bytes: 2000 },
      transcribeStatus: 'failed', transcribeError: 'sim error', fsImpl: realFs,
    });

    const html = realFs.readFileSync(path.join(tmpdir, 'transcript.html'), 'utf8');
    expect(html).toContain('class="chunk ok"');
    expect(html).toContain('class="chunk skipped"');
    expect(html).toContain('class="chunk failed"');
    expect(html).toMatch(/<!-- COUNT:START -->3<!-- COUNT:END -->/);
  });

  test('throws when wav is missing (catches misuse)', () => {
    expect(() => appendChunkToSessionHtml({ sidecar: sampleSidecar() }))
      .toThrow(/wav path is required/);
  });
});

describe('transcriptHtmlPathFor', () => {
  test('produces <dir>/transcript.html', () => {
    expect(transcriptHtmlPathFor(path.join('recordings', 'MeetingTest')))
      .toBe(path.join('recordings', 'MeetingTest', 'transcript.html'));
  });
});
