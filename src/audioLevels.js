// Pure helpers for interpreting 16-bit signed little-endian PCM and rendering
// a peak-level meter. Kept separate from the recorder/CLI so the math is
// unit-testable and reusable from tools/smoke-listen.js.

const BAR_WIDTH = 40;
const SILENCE_DB = -120;
const INT16_DENOM = 32768; // |min int16|; using this gives -32768 -> 1.0 exactly.

function peak16LE(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return 0;
  let peak = 0;
  const end = buf.length - (buf.length % 2);
  for (let i = 0; i < end; i += 2) {
    const s = buf.readInt16LE(i);
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  return peak / INT16_DENOM;
}

function toDb(normPeak) {
  if (!Number.isFinite(normPeak) || normPeak <= 0) return SILENCE_DB;
  if (normPeak >= 1) return 0;
  const db = 20 * Math.log10(normPeak);
  if (!Number.isFinite(db) || db <= SILENCE_DB) return SILENCE_DB;
  return db;
}

function renderBar(level, opts = {}) {
  const width = Number.isInteger(opts.width) && opts.width > 0 ? opts.width : BAR_WIDTH;
  const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const filled = Math.round(clamped * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

module.exports = {
  BAR_WIDTH,
  SILENCE_DB,
  INT16_DENOM,
  peak16LE,
  toDb,
  renderBar,
};
