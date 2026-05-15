'use strict';

const { filterHallucinations } = require('./hallucination');

/**
 * @typedef {{ text?: string, speaker?: number, speaker_id?: number, spkr?: number, speaker_turn_next?: boolean }} WhisperSegmentLike
 */

/**
 * Pull segment rows from whisper.cpp JSON (shape varies slightly by version).
 * @param {unknown} doc
 * @returns {WhisperSegmentLike[]}
 */
function extractSegments(doc) {
  if (!doc || typeof doc !== 'object') return [];
  const o = /** @type {Record<string, unknown>} */ (doc);
  const cand =
    o.segments
    || (Array.isArray(o.transcription) ? o.transcription : null)
    || (o.transcription && typeof o.transcription === 'object'
      ? /** @type {Record<string, unknown>} */ (o.transcription).segments
      : null)
    || (o.result && typeof o.result === 'object'
      ? /** @type {Record<string, unknown>} */ (o.result).segments
      : null);
  return Array.isArray(cand) ? /** @type {WhisperSegmentLike[]} */ (cand) : [];
}

function segmentText(seg) {
  if (!seg || typeof seg !== 'object') return '';
  const t = seg.text;
  return typeof t === 'string' ? t.replace(/\s*\[SPEAKER TURN\]\s*/g, ' ').trim() : '';
}

/**
 * Numeric speaker id from segment when whisper.cpp adds clustering / channel ids.
 * @param {WhisperSegmentLike} seg
 * @returns {number | null}
 */
function explicitSpeakerIndex(seg) {
  if (!seg || typeof seg !== 'object') return null;
  const v = seg.speaker ?? seg.speaker_id ?? seg.spkr;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

/**
 * True if any segment carries an explicit numeric speaker field.
 * @param {WhisperSegmentLike[]} segments
 */
function anyExplicitSpeaker(segments) {
  return segments.some((s) => explicitSpeakerIndex(s) != null);
}

/**
 * Assign a 0-based speaker index per segment using tinydiarize `speaker_turn_next`:
 * when segment[i-1].speaker_turn_next is truthy, the speaker changes before segment i.
 * @param {WhisperSegmentLike[]} segments
 * @param {number} index
 */
function tinydiarizeSpeakerIndexAt(segments, index) {
  let spk = 0;
  for (let i = 1; i <= index; i++) {
    const prev = segments[i - 1];
    const turn = prev && typeof prev === 'object'
      && !!(prev.speaker_turn_next);
    if (turn) spk += 1;
  }
  return spk;
}

/**
 * Merge consecutive segments that map to the same display speaker.
 * @param {WhisperSegmentLike[]} segments
 * @param {(seg: WhisperSegmentLike, i: number) => number} speakerFn  0-based speaker index
 * @returns {{ speakerIndex: number, text: string }[]}
 */
function groupBySpeaker(segments, speakerFn) {
  /** @type {{ speakerIndex: number, text: string }[]} */
  const rows = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const spk = speakerFn(seg, i);
    const raw = segmentText(seg);
    const fh = filterHallucinations(raw);
    const cleaned = fh.text.trim();
    if (!cleaned) continue;
    const last = rows[rows.length - 1];
    if (last && last.speakerIndex === spk) {
      last.text = `${last.text} ${cleaned}`.trim();
    } else {
      rows.push({ speakerIndex: spk, text: cleaned });
    }
  }
  return rows;
}

/**
 * Format whisper segments as "Speaker N:" lines (1-based labels).
 * @param {WhisperSegmentLike[]} segments
 * @returns {string}
 */
function formatSegmentsAsSpeakerTranscript(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';

  const explicit = anyExplicitSpeaker(segments);
  const speakerFn = explicit
    ? (seg) => {
      const n = explicitSpeakerIndex(seg);
      return n != null ? n : 0;
    }
    : (_seg, i) => tinydiarizeSpeakerIndexAt(segments, i);

  const rows = groupBySpeaker(segments, speakerFn);
  if (rows.length === 0) return '';

  return rows
    .map(({ speakerIndex, text }) => `Speaker ${speakerIndex + 1}: ${text}`)
    .join('\n\n');
}

module.exports = {
  extractSegments,
  segmentText,
  formatSegmentsAsSpeakerTranscript,
};
