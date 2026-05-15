'use strict';

const { spawn } = require('child_process');
const path = require('path');

const DIARIZE_SCRIPT = path.join(__dirname, '..', 'tools', 'diarize.py');

/**
 * Spawn tools/diarize.py for a single WAV chunk and return the segment array.
 * Never throws — errors are written to stderr and the caller receives [].
 *
 * @param {string} wavPath - Absolute path to the WAV chunk
 * @param {string|null} sessionEmbeddingsPath - Optional path to the cross-chunk embeddings JSON
 * @returns {Promise<Array<{start: number, end: number, speaker: string}>>}
 */
async function runDiarizer(wavPath, sessionEmbeddingsPath = null) {
  const args = [DIARIZE_SCRIPT, wavPath];
  if (sessionEmbeddingsPath) {
    args.push('--session-embeddings', sessionEmbeddingsPath);
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn('python', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (spawnErr) {
      process.stderr.write(`[diarize] spawn error: ${spawnErr.message}\n`);
      return resolve([]);
    }

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => {
      process.stderr.write(`[diarize] child error: ${err.message}\n`);
      resolve([]);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        process.stderr.write(
          `[diarize] exited ${code}${stderr ? ': ' + stderr.slice(0, 300) : ''}\n`,
        );
        resolve([]);
        return;
      }
      const raw = stdout.trim();
      if (!raw) {
        process.stderr.write('[diarize] empty output\n');
        resolve([]);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        process.stderr.write(`[diarize] JSON parse error: ${e.message} — head: ${raw.slice(0, 120)}\n`);
        resolve([]);
        return;
      }
      if (!Array.isArray(parsed)) {
        process.stderr.write(`[diarize] expected array, got: ${raw.slice(0, 120)}\n`);
        resolve([]);
        return;
      }
      resolve(parsed);
    });
  });
}

/**
 * Merge plain whisper transcript text with pyannote/resemblyzer diarization segments
 * by proportionally mapping sentences to the segment timeline.
 *
 * @param {string} transcriptText - Plain text from whisper
 * @param {Array<{start: number, end: number, speaker: string}>} segments - Diarization output
 * @param {number} chunkDurationSec - Total duration of the chunk in seconds
 * @returns {string} Formatted "Speaker N: ..." text
 */
function mergeTranscriptWithDiarization(transcriptText, segments, chunkDurationSec) {
  if (!transcriptText || !transcriptText.trim()) return transcriptText || '';

  const trimmed = transcriptText.trim();

  // No diarization data or single speaker → label everything as Speaker 1
  if (!segments || segments.length === 0) {
    return `Speaker 1: ${trimmed}`;
  }
  const uniqueSpeakers = new Set(segments.map((s) => s.speaker));
  if (uniqueSpeakers.size <= 1) {
    return `Speaker 1: ${trimmed}`;
  }

  // Split transcript into sentences/clauses on ". ", "? ", "! ", or newlines.
  // Lookbehind keeps the punctuation attached to its preceding sentence.
  const parts = trimmed
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return `Speaker 1: ${trimmed}`;

  const duration = chunkDurationSec > 0 ? chunkDurationSec : 1;

  // Assign each sentence to the diarization segment whose range covers its
  // proportional midpoint within the chunk. Fall back to the first segment if
  // no range matches (rounding edge at end of audio).
  const assigned = parts.map((text, i) => {
    const sentStart = (i / parts.length) * duration;
    const sentEnd = ((i + 1) / parts.length) * duration;
    const mid = (sentStart + sentEnd) / 2;

    let speaker = segments[0].speaker;
    for (const seg of segments) {
      if (mid >= seg.start && mid < seg.end) {
        speaker = seg.speaker;
        break;
      }
    }
    return { speaker, text };
  });

  // Merge consecutive sentences with the same speaker
  const grouped = [];
  for (const item of assigned) {
    const last = grouped[grouped.length - 1];
    if (last && last.speaker === item.speaker) {
      last.text = `${last.text} ${item.text}`;
    } else {
      grouped.push({ speaker: item.speaker, text: item.text });
    }
  }

  return grouped.map(({ speaker, text }) => `${speaker}: ${text}`).join('\n');
}

module.exports = { runDiarizer, mergeTranscriptWithDiarization };
