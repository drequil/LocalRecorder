// T-4: per-chunk markdown formatter.
//
// Each idle chunk produces a `.wav` (audio), a `.json` (sidecar metadata),
// optionally a `.txt` (whisper.cpp transcript), and -- as of T-4 -- a `.md`
// that combines all of the above into a human-reviewable artifact.
//
// This module is the *pure* formatter: it takes plain data in and returns a
// markdown string. No fs, no path joining beyond rendering relative names,
// no whisper.cpp dependencies. The integration layer (src/audioRecorder.js)
// is responsible for reading the sidecar JSON + the .txt, calling this
// formatter, and writing the result next to the .wav.
//
// Output shape (intentionally narrow so downstream summarisation can parse it):
//
//     # Chunk YYYY-MM-DD HH:MM:SS (chunk-...)
//
//     **Duration:** 11.52 s
//     **Peak:** -4.98 dBFS (0.563)
//     **Bytes:** 368 640
//     **Start:** 2026-05-12T21:23:01.490Z
//     **End:**   2026-05-12T21:23:13.523Z
//
//     **Files:** [chunk-...wav](chunk-...wav) | [chunk-...json](chunk-...json) | [chunk-...txt](chunk-...txt)
//
//     ## Transcript
//
//     <transcript text, verbatim>
//
// If transcription failed or was not attempted, the "## Transcript" section
// contains a single italicised line explaining why; the metadata block + file
// links are always present.

const path = require('path');

// ASCII-only minus sign to keep the markdown ASCII-clean for downstream tools
// that might choke on Unicode (-) in code blocks. Tests pin this character.
const MINUS = '-';

function formatNumberWithSeparator(n) {
  if (!Number.isFinite(n)) return String(n);
  // Use the locale-neutral thousand-separator form ("368 640") so the
  // formatter output is reproducible across machines with different locales.
  // The conventional NBSP-as-separator is harder to assert on, so use a
  // regular space here -- valid in markdown, easy to grep.
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatDurationSeconds(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(2)} s`;
  if (s < 60) return `${s.toFixed(1)} s`;
  const mins = Math.floor(s / 60);
  const secs = s - mins * 60;
  return `${mins}m ${secs.toFixed(1)}s`;
}

function formatPeak(peakDb, peak) {
  const dbStr = Number.isFinite(peakDb)
    ? `${peakDb < 0 ? MINUS : ''}${Math.abs(peakDb).toFixed(2)} dBFS`
    : 'unknown dBFS';
  const peakStr = Number.isFinite(peak) ? `(${peak.toFixed(3)})` : '';
  return peakStr ? `${dbStr} ${peakStr}` : dbStr;
}

function parseChunkTimestamp(basename) {
  // chunk-YYYYMMDD-HHMMSS-mmm[-N]
  const m = basename.match(/^chunk-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})(?:-(\d+))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, mmm, dup] = m;
  return {
    isoLocal: `${y}-${mo}-${d} ${h}:${mi}:${s}.${mmm}`,
    duplicate: dup ? parseInt(dup, 10) : null,
  };
}

function buildHeading(wavBasename) {
  const stem = wavBasename.replace(/\.wav$/i, '');
  const ts = parseChunkTimestamp(stem);
  if (!ts) return `# Chunk ${stem}`;
  const suffix = ts.duplicate ? ` #${ts.duplicate}` : '';
  return `# Chunk ${ts.isoLocal}${suffix} (${stem})`;
}

function formatAcceleratorLabel(transcribe) {
  // sidecar.transcribe is the GPU-2 sub-record. Returns a short human label
  // ("GPU", "CPU", "GPU (N layers)") or null if no transcribe block is present.
  if (!transcribe || typeof transcribe !== 'object') return null;
  if (transcribe.gpu === true) {
    return Number.isInteger(transcribe.gpuLayers) && transcribe.gpuLayers > 0
      ? `GPU (${transcribe.gpuLayers} layers)`
      : 'GPU';
  }
  if (transcribe.gpu === false) return 'CPU (forced)';
  return null; // gpu == null means "whisper.cpp default" — not worth a line
}

function buildMetadataBlock(sidecar) {
  const lines = [];
  lines.push(`**Duration:** ${formatDurationSeconds(sidecar.durationMs)}`);
  lines.push(`**Peak:** ${formatPeak(sidecar.peakDb, sidecar.peak)}`);
  if (Number.isFinite(sidecar.bytes)) {
    lines.push(`**Bytes:** ${formatNumberWithSeparator(sidecar.bytes)}`);
  }
  if (sidecar.start) lines.push(`**Start:** ${sidecar.start}`);
  if (sidecar.end) lines.push(`**End:**   ${sidecar.end}`);
  const acc = formatAcceleratorLabel(sidecar.transcribe);
  if (acc) lines.push(`**Accelerator:** ${acc}`);
  return lines.join('  \n'); // two-space line break (markdown soft break)
}

function buildFileLinks({ wavBasename, jsonBasename, txtBasename }) {
  const parts = [];
  if (wavBasename) parts.push(`[${wavBasename}](${wavBasename})`);
  if (jsonBasename) parts.push(`[${jsonBasename}](${jsonBasename})`);
  if (txtBasename) parts.push(`[${txtBasename}](${txtBasename})`);
  if (parts.length === 0) return '';
  return `**Files:** ${parts.join(' | ')}`;
}

function buildTranscriptSection({ transcript, transcribeError, transcribeStatus }) {
  // transcribeStatus: 'ok' | 'failed' | 'empty' | 'skipped' | 'pending'
  // - 'ok' with non-empty transcript -> render verbatim
  // - 'ok' with empty transcript -> empty-transcript stub (whisper returned "")
  // - 'failed' -> error stub
  // - 'skipped' -> sub-threshold stub (T-5 will use this)
  // - 'pending' -> not transcribed yet (e.g., transcribe mode off)
  const header = '## Transcript';
  if (transcribeStatus === 'ok' && transcript && transcript.trim().length > 0) {
    return `${header}\n\n${transcript.trim()}\n`;
  }
  if (transcribeStatus === 'ok') {
    return `${header}\n\n_No speech detected (whisper.cpp returned an empty transcript)._\n`;
  }
  if (transcribeStatus === 'failed') {
    const msg = transcribeError && transcribeError.trim()
      ? transcribeError.trim()
      : 'unknown error';
    return `${header}\n\n_Transcription unavailable: ${msg}_\n`;
  }
  if (transcribeStatus === 'skipped') {
    const reason = transcribeError && transcribeError.trim()
      ? transcribeError.trim()
      : 'reason unspecified';
    return `${header}\n\n_Skipped: ${reason}_\n`;
  }
  // pending / unknown
  return `${header}\n\n_Transcription not attempted._\n`;
}

// Main entry point. All arguments are plain data; this function never touches
// the filesystem.
//
// Inputs:
//   sidecar           - parsed sidecar JSON (schema v1; ducks {wav, start, end,
//                       durationMs, peak, peakDb, bytes})
//   transcript        - transcript string (may be empty / null)
//   transcribeStatus  - one of 'ok' | 'failed' | 'empty' | 'skipped' | 'pending'
//   transcribeError   - string explanation for 'failed' / 'skipped'; ignored otherwise
//   txtBasename       - basename of the .txt sibling, if one exists on disk
function formatChunkMarkdown({
  sidecar,
  transcript = null,
  transcribeStatus = 'pending',
  transcribeError = null,
  txtBasename = null,
} = {}) {
  if (!sidecar || typeof sidecar !== 'object') {
    throw new TypeError('formatChunkMarkdown: sidecar is required and must be an object');
  }
  const wavBasename = sidecar.wav || 'chunk.wav';
  const stem = wavBasename.replace(/\.wav$/i, '');
  const jsonBasename = `${stem}.json`;
  const hasRealTranscript = transcribeStatus === 'ok'
    && typeof transcript === 'string'
    && transcript.trim().length > 0;
  const finalTxt = txtBasename || (hasRealTranscript ? `${stem}.txt` : null);

  const sections = [];
  sections.push(buildHeading(wavBasename));
  sections.push(buildMetadataBlock(sidecar));
  const links = buildFileLinks({ wavBasename, jsonBasename, txtBasename: finalTxt });
  if (links) sections.push(links);
  sections.push(buildTranscriptSection({ transcript, transcribeError, transcribeStatus }));
  // Trailing newline + blank-line separation between sections matches the
  // existing markdown style in the docs/ directory.
  return sections.join('\n\n') + '\n';
}

function markdownPathFor(wavPath) {
  const dir = path.dirname(wavPath);
  const base = path.basename(wavPath, path.extname(wavPath));
  return path.join(dir, `${base}.md`);
}

module.exports = {
  formatChunkMarkdown,
  markdownPathFor,
  // Exported helpers (mostly for direct unit testing of edge cases).
  formatNumberWithSeparator,
  formatDurationSeconds,
  formatPeak,
  formatAcceleratorLabel,
  parseChunkTimestamp,
};
