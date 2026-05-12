// Per-session HTML transcript aggregator.
//
// While T-4's per-chunk `.md` is great for reviewing a single chunk in
// isolation, the user-facing artifact for an entire meeting is "one document I
// can scroll". This module produces that: a single `transcript.html` in the
// session directory that grows live as chunks complete.
//
// Design:
//   1. Pure render functions for the document template and per-chunk sections.
//      No fs in this file's render helpers -- they take data, return strings.
//   2. A single side-effecting helper, appendChunkToSessionHtml, does the
//      "read transcript.html, splice in new section, write back" dance. If
//      the file doesn't exist yet it gets created with a fresh document.
//   3. Splicing happens at the literal CHUNK_END_MARKER string -- a thin
//      contract between the renderer and the appender. As long as the marker
//      is unique in the document (which we control), the splice is safe.
//
// The HTML is intentionally inline-styled and self-contained. No external CSS
// or JS so the user can email/copy the file and the styling travels with it.

const path = require('path');
const fs = require('fs');

const CHUNK_START_MARKER = '<!-- CHUNKS:START -->';
const CHUNK_END_MARKER = '<!-- CHUNKS:END -->';
const COUNT_MARKER_START = '<!-- COUNT:START -->';
const COUNT_MARKER_END = '<!-- COUNT:END -->';

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    max-width: 820px;
    margin: 2rem auto;
    padding: 0 1rem;
    line-height: 1.55;
  }
  h1 { border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
  h2 { font-size: 1.05rem; margin: 1.5rem 0 0.4rem; color: #555; font-weight: 600; }
  h2 small { color: #888; font-weight: 400; font-size: 0.88em; margin-left: 0.4em; }
  .meta { color: #888; font-size: 0.85em; }
  .chunk { padding: 0.5rem 0.75rem; border-left: 3px solid #8884;
           margin: 0.6rem 0; background: #8881; border-radius: 0 4px 4px 0; }
  .chunk.skipped, .chunk.failed { border-left-color: #c80; opacity: 0.75; }
  .chunk .transcript { margin: 0.2rem 0 0; white-space: pre-wrap;
                       font-family: inherit; }
  .chunk .stub { color: #c80; font-style: italic; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #8884; }
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const mins = Math.floor(s / 60);
  const secs = s - mins * 60;
  return `${mins}m ${secs.toFixed(0)}s`;
}

function formatPeakDb(peakDb) {
  if (!Number.isFinite(peakDb)) return '';
  const sign = peakDb < 0 ? '-' : '';
  return `${sign}${Math.abs(peakDb).toFixed(1)} dBFS`;
}

// Render the H2 heading for a chunk -- a compact one-liner with the chunk's
// timestamp + duration + peak + bytes. Designed to scan quickly when scrolling
// a long meeting.
function buildChunkHeading(sidecar) {
  const stem = (sidecar.wav || 'chunk').replace(/\.wav$/i, '');
  // Pull HH:MM:SS out of the chunk-YYYYMMDD-HHMMSS-mmm filename if possible.
  const m = stem.match(/^chunk-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})/);
  let label = stem;
  if (m) {
    const [, y, mo, d, h, mi, s, mmm] = m;
    label = `${h}:${mi}:${s}`;
    // Date is implicit in the session metadata; surface only HH:MM:SS in the
    // chunk heading. Full ISO timestamp is in the title attribute on hover.
  }
  const bits = [
    formatDuration(sidecar.durationMs),
    formatPeakDb(sidecar.peakDb),
    formatBytes(sidecar.bytes),
  ].filter(Boolean);
  const detail = bits.length ? ` <small>(${escapeHtml(bits.join(' | '))})</small>` : '';
  return `<h2 title="${escapeHtml(stem)}">${escapeHtml(label)}${detail}</h2>`;
}

function buildChunkBody({ transcript, transcribeStatus, transcribeError }) {
  if (transcribeStatus === 'ok' && transcript && transcript.trim().length > 0) {
    return `<p class="transcript">${escapeHtml(transcript.trim())}</p>`;
  }
  if (transcribeStatus === 'ok') {
    return `<p class="stub">No speech detected.</p>`;
  }
  if (transcribeStatus === 'skipped') {
    const reason = transcribeError && transcribeError.trim()
      ? transcribeError.trim() : 'below threshold';
    return `<p class="stub">Skipped: ${escapeHtml(reason)}</p>`;
  }
  if (transcribeStatus === 'failed') {
    const reason = transcribeError && transcribeError.trim()
      ? transcribeError.trim() : 'unknown error';
    return `<p class="stub">Transcription failed: ${escapeHtml(reason)}</p>`;
  }
  return `<p class="stub">Transcription pending.</p>`;
}

function renderChunkSectionHtml({ sidecar, transcript, transcribeStatus, transcribeError }) {
  if (!sidecar || typeof sidecar !== 'object') {
    throw new TypeError('renderChunkSectionHtml: sidecar is required');
  }
  const klass = transcribeStatus === 'failed' ? 'chunk failed'
    : transcribeStatus === 'skipped' ? 'chunk skipped'
      : 'chunk ok';
  return `<section class="${klass}">\n  ${buildChunkHeading(sidecar)}\n  ${buildChunkBody({ transcript, transcribeStatus, transcribeError })}\n</section>`;
}

// Build the initial document, with no chunks yet. Subsequent chunks splice
// themselves in between CHUNK_START_MARKER and CHUNK_END_MARKER. The chunk
// count is similarly marked so we can keep it accurate as the session grows.
function renderSessionDocumentInitial({ sessionLabel = 'session', startedAt = new Date() } = {}) {
  const safeLabel = escapeHtml(sessionLabel);
  const isoStart = startedAt instanceof Date ? startedAt.toISOString() : String(startedAt);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeLabel} &mdash; LocalRecorder transcript</title>
  <style>${STYLE}</style>
</head>
<body>
  <header>
    <h1>${safeLabel}</h1>
    <p class="meta">Session started ${escapeHtml(isoStart)} &middot; ${COUNT_MARKER_START}0${COUNT_MARKER_END} chunks transcribed</p>
  </header>
  <main>
    ${CHUNK_START_MARKER}
    ${CHUNK_END_MARKER}
  </main>
  <footer>
    <p class="meta">Generated by LocalRecorder. This file updates live as chunks complete.</p>
  </footer>
</body>
</html>
`;
}

function transcriptHtmlPathFor(sessionDir) {
  return path.join(sessionDir, 'transcript.html');
}

// Splice a chunk section into an existing transcript.html string. Returns the
// updated string. Exported for unit testing without fs.
function spliceChunkSection(existing, sectionHtml) {
  const idx = existing.lastIndexOf(CHUNK_END_MARKER);
  if (idx < 0) {
    // Document is corrupt or written by an older version that didn't use
    // markers. Append the section to the end as a best-effort recovery; the
    // file may look slightly off but no data is lost.
    return existing + '\n' + sectionHtml + '\n';
  }
  return existing.slice(0, idx) + sectionHtml + '\n    ' + existing.slice(idx);
}

// Increment the chunk count in the meta line. Tolerates a missing marker by
// returning the document unchanged (the count is cosmetic, not load-bearing).
function bumpChunkCount(html) {
  const startIdx = html.indexOf(COUNT_MARKER_START);
  const endIdx = html.indexOf(COUNT_MARKER_END);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return html;
  const before = html.slice(0, startIdx + COUNT_MARKER_START.length);
  const after = html.slice(endIdx);
  const middle = html.slice(startIdx + COUNT_MARKER_START.length, endIdx);
  const current = parseInt(middle, 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  return `${before}${next}${after}`;
}

// Side-effecting top-level helper. Reads (or creates) the session transcript
// html at <sessionDir>/transcript.html, splices in the chunk section, and
// writes the result back. Returns the path written.
function appendChunkToSessionHtml({
  wav,
  sidecar,
  transcript = null,
  transcribeStatus = 'pending',
  transcribeError = null,
  sessionLabel = null,
  fsImpl = fs,
  now = new Date(),
}) {
  if (!wav || typeof wav !== 'string') {
    throw new TypeError('appendChunkToSessionHtml: wav path is required');
  }
  const sessionDir = path.dirname(wav);
  const htmlPath = transcriptHtmlPathFor(sessionDir);
  const section = renderChunkSectionHtml({ sidecar, transcript, transcribeStatus, transcribeError });

  let existing;
  try {
    existing = fsImpl.readFileSync(htmlPath, 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    existing = renderSessionDocumentInitial({
      sessionLabel: sessionLabel || path.basename(sessionDir),
      startedAt: now,
    });
  }
  const withSection = spliceChunkSection(existing, section);
  const withCount = bumpChunkCount(withSection);
  fsImpl.writeFileSync(htmlPath, withCount);
  return htmlPath;
}

module.exports = {
  appendChunkToSessionHtml,
  renderSessionDocumentInitial,
  renderChunkSectionHtml,
  spliceChunkSection,
  bumpChunkCount,
  transcriptHtmlPathFor,
  CHUNK_START_MARKER,
  CHUNK_END_MARKER,
  // Re-exported helpers for unit-test coverage; not load-bearing API.
  escapeHtml,
  formatBytes,
  formatDuration,
  formatPeakDb,
};
