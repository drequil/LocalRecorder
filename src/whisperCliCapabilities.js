'use strict';

const { probeBinary } = require('../tools/check-transcribe-deps');

/** @type {Map<string, object | null>} */
const memo = new Map();

/**
 * @typedef {{
 *   outputJson: boolean,
 *   outputJsonFull: boolean,
 *   tinydiarize: boolean,
 *   stereoDiarize: boolean,
 * }} WhisperCliCapabilities
 */

/**
 * Pure: derive feature flags from `whisper-cli --help` text (stdout or stderr).
 * @param {string} text
 * @returns {WhisperCliCapabilities}
 */
function parseCapabilitiesFromHelp(text) {
  const s = text || '';
  // Avoid leading `\b` before `-short` flags: `-` is not a word character in JS regex.
  return {
    outputJson: /--output-json\b/.test(s) || /[\s,(]-oj\b/.test(s),
    outputJsonFull: /--output-json-full\b/.test(s) || /[\s,(]-ojf\b/.test(s),
    tinydiarize: /--tinydiarize\b/.test(s) || /[\s,(]-tdrz\b/.test(s),
    stereoDiarize: /--diarize\b/.test(s) || /[\s,(]-di\b/.test(s),
  };
}

/**
 * Probe once per binary path and cache. Uses the same --help probe as check-transcribe-deps.
 * @param {string} binary  Resolved whisper-cli path or bare command name
 * @returns {WhisperCliCapabilities | null}  null when probe fails
 */
function getWhisperCliCapabilities(binary) {
  if (!binary || typeof binary !== 'string') return null;
  if (memo.has(binary)) return memo.get(binary);
  const res = probeBinary(binary);
  const text = res && res.ok ? `${res.stdout || ''}\n${res.stderr || ''}` : '';
  if (!res || !res.ok) {
    memo.set(binary, null);
    return null;
  }
  const caps = parseCapabilitiesFromHelp(text);
  memo.set(binary, caps);
  return caps;
}

function clearWhisperCliCapabilitiesMemoForTests() {
  memo.clear();
}

module.exports = {
  parseCapabilitiesFromHelp,
  getWhisperCliCapabilities,
};
