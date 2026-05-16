#!/usr/bin/env node
'use strict';

/*
 * End-to-end UAT for the diarization pipeline.
 *
 * Headless. No browser, no UI, no microphone, no HTTP server. For each test
 * case we:
 *   1. Run whisper-cli (transcribeFile) to get plain text.
 *   2. Run tools/diarize.py (runDiarizer) on the same WAV — no session
 *      embeddings, since we want each file judged on its own.
 *   3. Merge the two with mergeTranscriptWithDiarization.
 *   4. Assert speaker count is within ±1 of expectedSpeakers.
 *   5. Assert merged transcript length > minTextLength.
 *   6. Print the full labeled transcript so we can eyeball quality.
 *
 * The point is to *measure* current diarization quality honestly, not to
 * make it green by softening assertions. Failures here are evidence we may
 * need to swap to pyannote.
 *
 * Usage: `npm run uat:diarize`
 * Exit code: 0 if all cases pass, 1 otherwise.
 */

const fs = require('fs');
const path = require('path');

const { transcribeFile, DEFAULT_MODEL_PATH } = require('../src/transcribe');
const { runDiarizer, mergeTranscriptWithDiarization } = require('../src/diarize');

// All test cases run from repo root. Keep paths relative so the file is
// portable across machines.
const TEST_CASES = [
  { wav: 'test-audio/david-zira-piano.wav', expectedSpeakers: 2, minTextLength: 20, label: 'TTS two speakers (David + Zira)' },
  { wav: 'test-audio/zira-finish-soon.wav', expectedSpeakers: 1, minTextLength: 10, label: 'TTS single speaker (Zira)' },
  { wav: 'test-audio/cashew-walk.wav', expectedSpeakers: 1, minTextLength: 10, label: 'TTS single speaker (dog command)' },
  { wav: 'test-audio/downloaded-two-speakers.wav', expectedSpeakers: 2, minTextLength: 50, label: 'Real speech two speakers' },
  { wav: 'test-audio/arctic-slt.wav', expectedSpeakers: 1, minTextLength: 10, label: 'CMU Arctic female single speaker' },
  { wav: 'test-audio/arctic-bdl.wav', expectedSpeakers: 1, minTextLength: 10, label: 'CMU Arctic male single speaker' },
];

// 16 kHz, 16-bit, mono PCM = 32_000 bytes/sec. The 44-byte WAV header is
// stripped before computing seconds. Used only to drive the proportional
// sentence/segment merge in mergeTranscriptWithDiarization — a few percent
// of error is fine.
function chunkDurationSecFromWav(wavPath) {
  const stat = fs.statSync(wavPath);
  const seconds = (stat.size - 44) / 32000;
  return seconds > 0 ? seconds : 0;
}

function uniqueSpeakerCount(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  return new Set(segments.map((s) => s.speaker)).size;
}

function pickWhisperModel() {
  // Allow override via env (lets us bench a smaller/larger model without
  // editing this file), but default to the same path the production server
  // uses so the UAT measures real-world behaviour.
  const fromEnv = process.env.WHISPER_MODEL && process.env.WHISPER_MODEL.trim();
  const candidate = fromEnv || DEFAULT_MODEL_PATH;
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `UAT: whisper model not found at ${candidate}.\n` +
      '  Run `npm run model:download-base` or set WHISPER_MODEL to an existing .bin path.'
    );
  }
  return candidate;
}

function fmtElapsed(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runOneCase(testCase, model) {
  const start = Date.now();
  const wavAbs = path.resolve(testCase.wav);

  if (!fs.existsSync(wavAbs)) {
    return {
      ...testCase,
      ok: false,
      reason: `WAV not found: ${testCase.wav}`,
      speakerCount: 0,
      textLength: 0,
      elapsedMs: Date.now() - start,
    };
  }

  // 1. Whisper transcript (no speaker labels — diarization handles that).
  const trans = await transcribeFile({ wav: wavAbs, model });
  const transcript = (trans.text || '').trim();

  // 2. Diarization. No session embeddings: each file judged independently.
  const segments = await runDiarizer(wavAbs, null);

  // 3. Merge.
  const duration = chunkDurationSecFromWav(wavAbs);
  const labeled = mergeTranscriptWithDiarization(transcript, segments, duration);

  const speakerCount = uniqueSpeakerCount(segments);
  const textLength = labeled.length;

  const speakerOk = Math.abs(speakerCount - testCase.expectedSpeakers) <= 1;
  const textOk = textLength > testCase.minTextLength;

  let reason = null;
  if (!speakerOk && !textOk) {
    reason = `speakers ${speakerCount} outside ${testCase.expectedSpeakers}±1 AND text ${textLength} ≤ ${testCase.minTextLength}`;
  } else if (!speakerOk) {
    reason = speakerCount > testCase.expectedSpeakers + 1
      ? 'too many speakers'
      : 'too few speakers';
  } else if (!textOk) {
    reason = `text too short (${textLength} ≤ ${testCase.minTextLength})`;
  }

  return {
    ...testCase,
    ok: speakerOk && textOk,
    reason,
    speakerCount,
    textLength,
    transcript,
    labeled,
    segments,
    duration,
    elapsedMs: Date.now() - start,
  };
}

function pad(str, n) {
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

async function main() {
  console.log('=== Diarization UAT ===');
  const model = pickWhisperModel();
  console.log(`Whisper model: ${model}`);
  console.log(`Cases:         ${TEST_CASES.length}`);
  console.log('');

  const results = [];
  for (const tc of TEST_CASES) {
    console.log(`--- ${tc.label} (${tc.wav}) ---`);
    let result;
    try {
      result = await runOneCase(tc, model);
    } catch (err) {
      result = {
        ...tc,
        ok: false,
        reason: `exception: ${err && err.message ? err.message : String(err)}`,
        speakerCount: 0,
        textLength: 0,
        elapsedMs: 0,
      };
      console.error(`  ERROR: ${result.reason}`);
      if (err && err.stack) console.error(err.stack);
    }
    results.push(result);

    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(
      `  [${status}] speakers=${result.speakerCount} (expected ${tc.expectedSpeakers}±1)  ` +
      `text=${result.textLength} chars (min ${tc.minTextLength})  ` +
      `elapsed=${fmtElapsed(result.elapsedMs)}`
    );
    if (result.reason) console.log(`  reason: ${result.reason}`);
    if (typeof result.duration === 'number') {
      console.log(`  duration~${result.duration.toFixed(2)}s  segments=${(result.segments || []).length}`);
    }
    if (result.transcript !== undefined) {
      console.log(`  whisper: ${JSON.stringify(result.transcript)}`);
    }
    if (result.labeled !== undefined) {
      console.log('  labeled transcript:');
      for (const line of String(result.labeled).split('\n')) {
        console.log(`    ${line}`);
      }
    }
    console.log('');
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;

  // Width the file column to the longest basename so the summary lines up.
  const nameWidth = Math.max(
    ...results.map((r) => path.basename(r.wav).length),
    20,
  );

  console.log('=== UAT RESULTS ===');
  for (const r of results) {
    const mark = r.ok ? '\u2713' : '\u2717';
    const name = pad(path.basename(r.wav), nameWidth);
    const head = `${mark} ${name}  speakers=${r.speakerCount}  expected=${r.expectedSpeakers}  text=${r.textLength} chars`;
    if (r.ok) {
      console.log(head);
    } else {
      console.log(`${head}  [FAIL: ${r.reason || 'unknown'}]`);
    }
  }
  console.log(`${passed}/${total} passed`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('UAT runner crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
