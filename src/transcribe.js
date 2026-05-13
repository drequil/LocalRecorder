// T-2: thin wrapper around the whisper.cpp CLI for transcribing a single WAV.
//
// Design goals:
//   1. Re-use T-1's binary discovery (WHISPER_CANDIDATES + probeBinary) so we don't have
//      two competing definitions of "what counts as a whisper.cpp CLI".
//   2. Keep the pure bits (path resolution, arg construction, WAV magic check) trivially
//      unit-testable without spawning anything.
//   3. Make the async transcribeFile() seam injectable (spawnFn, resolveBinaryFn) so the
//      jest suite can exercise success and failure paths without a real model file or a
//      real whisper-cli binary.
//   4. Be defensive about whisper.cpp's output filename convention: with `-otxt` and no
//      `-of`, current builds write `<input-without-ext>.txt`, but older releases wrote
//      `<input>.txt` (appending). expectedTxtPaths() returns both candidates so we tolerate
//      either.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  WHISPER_CANDIDATES,
  pickCandidateBinary,
  probeBinary,
} = require('../tools/check-transcribe-deps');
const { trace } = require('./trace');

// T-2 spec says: "sensible default model (`./models/ggml-base.en.bin` if present, else
// error)". This matches whisper-cli's own documented default (`-m FNAME` defaults to
// `models/ggml-base.en.bin`) so a user who has installed the model in the conventional
// place gets a zero-flag invocation.
const DEFAULT_MODEL_PATH = path.join('models', 'ggml-base.en.bin');

// Returns the candidate text-output paths whisper.cpp may produce for `wavPath`.
// Current whisper.cpp writes <basename-without-ext>.txt; some legacy builds wrote
// <full-name>.txt. Caller should pick whichever exists after the spawn.
function expectedTxtPaths(wavPath) {
  if (typeof wavPath !== 'string' || wavPath.length === 0) {
    throw new TypeError('expectedTxtPaths: wavPath must be a non-empty string');
  }
  const dir = path.dirname(wavPath);
  const ext = path.extname(wavPath);
  const stem = path.basename(wavPath, ext);
  return [
    path.join(dir, `${stem}.txt`),
    `${wavPath}.txt`,
  ];
}

// Cheap RIFF/WAVE magic check. Whisper.cpp will reject a non-WAV with a less-friendly
// error; we surface the problem early with a clear message of our own.
function isWavFile(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const read = fs.readSync(fd, buf, 0, 12, 0);
    if (read < 12) return false;
    const magic = buf.slice(0, 4).toString('ascii');
    const form = buf.slice(8, 12).toString('ascii');
    return magic === 'RIFF' && form === 'WAVE';
  } catch (_) {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }
}

// Pure: shape the argv we will hand to spawn. Kept separate so tests can pin the exact
// flag order without exercising spawn.
function buildWhisperArgs({ model, wav, language = null }) {
  if (!model) throw new TypeError('buildWhisperArgs: model is required');
  if (!wav) throw new TypeError('buildWhisperArgs: wav is required');
  // --no-prints: suppress whisper-cli's progress chatter so stdout is clean.
  // --output-txt: emit the .txt sibling we will read after exit.
  // -l: whisper.cpp source language (ISO 639-1, e.g. hi, zh, en). Omitted when unset so
  //     whisper auto-detects (good for mixed audio). For CJK, callers often pass -l zh.
  const args = ['--no-prints', '--output-txt', '-m', model];
  if (language != null && String(language).trim() !== '') {
    args.push('-l', String(language).trim());
  }
  args.push('-f', wav);
  return args;
}

// Discover the whisper.cpp CLI binary on PATH. Pure-ish — accepts a probe injector so
// tests don't have to mock child_process.spawnSync at the module level.
function resolveBinary({ probe = probeBinary, candidates = WHISPER_CANDIDATES } = {}) {
  const pick = pickCandidateBinary(candidates, probe);
  return pick.picked;
}

// Read whichever of expectedTxtPaths(wav) exists. Returns { text, txtPath } or null
// if neither was produced (which we treat as an error: whisper-cli exited 0 but didn't
// honour --output-txt).
function readTranscriptFile(wav) {
  for (const candidate of expectedTxtPaths(wav)) {
    try {
      const text = fs.readFileSync(candidate, 'utf8').trim();
      return { text, txtPath: candidate };
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
  }
  return null;
}

// Async entry point. Transcribes a single WAV via whisper-cli and returns
// { text, model, wav, binary, durationMs, txtPath, exitCode }. Throws on missing
// preconditions (binary, model, wav) or a non-zero exit from whisper-cli.
async function transcribeFile({
  wav,
  model = DEFAULT_MODEL_PATH,
  language = null,
  binary = null,
  spawnFn = spawn,
  resolveBinaryFn = resolveBinary,
  fsImpl = fs,
} = {}) {
  if (!wav || typeof wav !== 'string') {
    throw new Error('transcribe: wav path is required');
  }
  if (!fsImpl.existsSync(wav)) {
    throw new Error(`transcribe: WAV file not found: ${wav}`);
  }
  if (!isWavFile(wav)) {
    throw new Error(`transcribe: not a WAV file (RIFF/WAVE header missing): ${wav}`);
  }
  if (!fsImpl.existsSync(model)) {
    throw new Error(
      `transcribe: model file not found: ${model}\n` +
      '  Pass --model <path>, or download a model to the default location:\n' +
      '    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
    );
  }

  const resolvedBinary = binary || resolveBinaryFn();
  if (!resolvedBinary) {
    trace('whisper', 'resolveBinary: no CLI on PATH');
    throw new Error(
      'transcribe: no whisper.cpp CLI found on PATH.\n' +
      '  Run `npm run transcribe:check` for install instructions.'
    );
  }

  const args = buildWhisperArgs({ model, wav, language });
  trace('whisper', 'spawn', { binary: resolvedBinary, args, wav, model, language: language || null });
  const startedAt = Date.now();

  let stdout = '';
  let stderr = '';
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawnFn(resolvedBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });

  const durationMs = Date.now() - startedAt;

  if (exitCode !== 0) {
    trace('whisper', 'non-zero exit', { exitCode, stderrHead: (stderr || '').slice(0, 500) });
    const err = new Error(`transcribe: whisper-cli exited with code ${exitCode}`);
    err.exitCode = exitCode;
    err.stderr = stderr;
    err.stdout = stdout;
    throw err;
  }

  const transcript = readTranscriptFile(wav);
  if (transcript === null) {
    trace('whisper', 'exit 0 but no .txt found', { tried: expectedTxtPaths(wav), stderrHead: (stderr || '').slice(0, 400) });
    const tried = expectedTxtPaths(wav).join(' | ');
    const stderrHead = (stderr || '').split(/\r?\n/).filter(Boolean).slice(0, 3).join(' / ');
    throw new Error(
      `transcribe: whisper-cli exited 0 but produced no .txt output.\n` +
      `  Tried: ${tried}\n` +
      (stderrHead ? `  stderr: ${stderrHead}` : '')
    );
  }

  trace('whisper', 'success', {
    durationMs,
    txtPath: transcript.txtPath,
    textChars: (transcript.text || '').length,
  });

  return {
    text: transcript.text,
    model,
    wav,
    language: language != null && String(language).trim() !== '' ? String(language).trim() : null,
    binary: resolvedBinary,
    durationMs,
    txtPath: transcript.txtPath,
    exitCode,
  };
}

module.exports = {
  DEFAULT_MODEL_PATH,
  expectedTxtPaths,
  isWavFile,
  buildWhisperArgs,
  resolveBinary,
  readTranscriptFile,
  transcribeFile,
};
