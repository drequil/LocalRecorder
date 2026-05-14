// Post-processing filter for well-known whisper.cpp hallucinations.
//
// When whisper processes a chunk that is mostly silence or low-SNR audio it
// pattern-matches to phrases that commonly appear at the end of the training
// corpus (podcasts, YouTube, lectures).  Typical examples:
//
//   "Thank you."  "Thank you for watching."  "you"  "[Music]"  "Bye-bye."
//
// Strategy:
//   1. Split the transcript into lines.
//   2. Mark each non-empty line as a hallucination if it matches the blacklist.
//   3. Return the cleaned text (hallucinated lines removed).
//   4. If every non-empty line was hallucinated, return an empty string so the
//      caller can treat the chunk as silent.  The original .wav is kept — only
//      the .txt content is sanitised.
//
// The filter is intentionally conservative (short blacklist, anchored regexes)
// so legitimate speech that happens to contain "thank you" mid-sentence is NOT
// removed.  Only lines whose *entire* content matches a hallucination pattern
// are stripped.

// Each regex is anchored to the full line (after trimming whitespace and
// trailing punctuation).  Patterns cover:
//   - Whisper's [bracket] noise tokens
//   - Generic filler ("you", "Mm-hmm", "Uh-huh")
//   - Thank-you / subscribe / bye variants ubiquitous in training data
const HALLUCINATION_LINE_PATTERNS = [
  /^\[blank_audio\]$/i,
  /^\[music\]$/i,
  /^\[applause\]$/i,
  /^\[laughter\]$/i,
  /^\[noise\]$/i,
  /^\[silence\]$/i,
  /^\[inaudible\]$/i,
  /^\[no speech detected\]$/i,
  // "you" / "You." alone
  /^you[.,!?]*$/i,
  // "Mm-hmm", "Uh-huh", "Mm" alone (filler)
  /^(mm+[-]*(hmm+)?|uh[-]*huh)[.,!?]*$/i,
  // "Thank you" variants
  /^thank you[,.]?(\s+(very much|so much|for watching|for listening|everyone|all))?[.,!?]*$/i,
  // "Thanks for watching / listening"
  /^thanks\s+for\s+(watching|listening)[.,!?]*$/i,
  // "Please subscribe", "Like and subscribe", "Subscribe"
  /^(please\s+)?(like(\s+and\s+subscribe)?|subscribe(\s+now)?)[.,!?]*$/i,
  // "Bye" / "Bye-bye" / "Goodbye"
  /^(bye[-\s]*bye|bye|goodbye)[.,!?]*$/i,
  // Subtitles/captions attribution lines
  /^(subtitles|captions|translation)\s+by\b/i,
];

/**
 * Returns true if the line (trimmed, stripped of surrounding punctuation) is a
 * known hallucination pattern.  Does NOT strip punctuation mid-line — only
 * leading/trailing — so "Thank you for your time, please continue" is NOT
 * matched.
 */
function isHallucinatedLine(line) {
  const t = line.trim();
  if (t.length === 0) return false;
  for (const re of HALLUCINATION_LINE_PATTERNS) {
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * Filter hallucinated lines from a transcript.
 *
 * @param {string} text  Raw text from whisper.cpp
 * @returns {{
 *   text: string,          cleaned text (may be empty string)
 *   removedCount: number,  how many lines were dropped
 *   totalLines: number,    total non-empty lines before filtering
 *   allRemoved: boolean,   true when every non-empty line was hallucinated
 * }}
 */
function filterHallucinations(text) {
  if (typeof text !== 'string') {
    return { text: '', removedCount: 0, totalLines: 0, allRemoved: false };
  }

  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const kept = lines.filter((l) => l.trim().length === 0 || !isHallucinatedLine(l));
  const removedCount = nonEmpty.length - kept.filter((l) => l.trim().length > 0).length;
  const cleaned = kept.join('\n').trim();

  return {
    text: cleaned,
    removedCount,
    totalLines: nonEmpty.length,
    allRemoved: nonEmpty.length > 0 && removedCount === nonEmpty.length,
  };
}

module.exports = {
  HALLUCINATION_LINE_PATTERNS,
  isHallucinatedLine,
  filterHallucinations,
};
