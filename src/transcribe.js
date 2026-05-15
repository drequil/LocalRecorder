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
  resolveWithVendor,
} = require('../tools/check-transcribe-deps');
const { trace } = require('./trace');
const { getWhisperCliCapabilities } = require('./whisperCliCapabilities');
const { extractSegments, formatSegmentsAsSpeakerTranscript } = require('./speakerTranscript');

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

// Same basename convention as .txt / whisper.cpp JSON export (-oj / -ojf).
function expectedJsonPaths(wavPath) {
  if (typeof wavPath !== 'string' || wavPath.length === 0) {
    throw new TypeError('expectedJsonPaths: wavPath must be a non-empty string');
  }
  const dir = path.dirname(wavPath);
  const ext = path.extname(wavPath);
  const stem = path.basename(wavPath, ext);
  return [
    path.join(dir, `${stem}.json`),
    `${wavPath}.json`,
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
function buildWhisperArgs({
  model, wav, language = null, threads = null,
  noSpeechThreshold = null, entropyThreshold = null,
  gpu = null, gpuLayers = null,
  speakerLabelMode = null,
}) {
  if (!model) throw new TypeError('buildWhisperArgs: model is required');
  if (!wav) throw new TypeError('buildWhisperArgs: wav is required');
  // --no-prints: suppress whisper-cli's progress chatter so stdout is clean.
  // --output-txt: emit the .txt sibling we will read after exit.
  // -t N: CPU thread count (default min(cpus,8); see resolveTranscribeThreads).
  // --no-speech-thold: probability above which a segment is classified as
  //   silence and dropped. Whisper default 0.6 is too permissive; we raise it
  //   to 0.8 to suppress "Thank you"/"[Music]" hallucinations on quiet chunks.
  // --entropy-thold: segments with token-level entropy above this are discarded
  //   as uncertain. Whisper default 2.4; we raise to 2.8.
  // -l: whisper.cpp source language (ISO 639-1). Omitted → auto-detect.
  // GPU semantics (GPU-2):
  //   gpu === false      → emit `--no-gpu` (hard CPU override; works on any
  //                        whisper.cpp build that surfaces the flag).
  //   gpu === true       → emit `-ngl <N>` only if gpuLayers is a positive int.
  //                        Otherwise omit; CUDA builds default to all layers.
  //   gpu == null        → emit nothing; let whisper.cpp's own default decide
  //                        (CUDA build → GPU; CPU-only build → CPU).
  // We keep the GPU flags adjacent to threads (-t) so the flag order is stable
  // and easy to eyeball in the trace log.
  const args = ['--no-prints', '--output-txt', '-m', model];
  if (threads != null && Number.isInteger(threads) && threads > 0) {
    args.push('-t', String(threads));
  }
  if (gpu === false) {
    args.push('--no-gpu');
  } else if (gpu === true && gpuLayers != null && Number.isInteger(gpuLayers) && gpuLayers > 0) {
    args.push('-ngl', String(gpuLayers));
  }
  if (noSpeechThreshold != null && Number.isFinite(noSpeechThreshold)) {
    args.push('--no-speech-thold', String(noSpeechThreshold));
  }
  if (entropyThreshold != null && Number.isFinite(entropyThreshold)) {
    args.push('--entropy-thold', String(entropyThreshold));
  }
  if (language != null && String(language).trim() !== '') {
    args.push('-l', String(language).trim());
  }
  if (speakerLabelMode === 'tinydiarize') {
    args.push('--tinydiarize', '--output-json', '--output-json-full');
  } else if (speakerLabelMode === 'stereo') {
    args.push('--diarize', '--output-json', '--output-json-full');
  }
  args.push('-f', wav);
  return args;
}

// Discover the whisper.cpp CLI binary. GPU-4: prefers `vendor/whisper-cuda/`
// (where `npm run gpu:install` extracts a cuBLAS build) over PATH so an
// installer run wins without the user editing PATH. Pure-ish — accepts a
// probe injector so tests don't have to mock child_process.spawnSync.
function resolveBinary({ probe = probeBinary, candidates = WHISPER_CANDIDATES } = {}) {
  return resolveWithVendor(candidates, { probe });
}

// Read whichever of expectedTxtPaths(wav) exists. Returns { text, txtPath } or null
// if neither was produced (which we treat as an error: whisper-cli exited 0 but didn't
// honour --output-txt).
function readTranscriptFile(wav, fsImpl = fs) {
  for (const candidate of expectedTxtPaths(wav)) {
    try {
      const text = fsImpl.readFileSync(candidate, 'utf8').trim();
      return { text, txtPath: candidate };
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
  }
  return null;
}

// Read whisper.cpp JSON output when -oj / -ojf were passed.
function readWhisperJsonFile(wav, fsImpl = fs) {
  for (const candidate of expectedJsonPaths(wav)) {
    let raw;
    try {
      raw = fsImpl.readFileSync(candidate, 'utf8').trim();
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (!raw) continue;
    try {
      const doc = JSON.parse(raw);
      return { doc, jsonPath: candidate };
    } catch (e) {
      if (e instanceof SyntaxError) {
        trace('whisper', 'json parse failed', { path: candidate, head: raw.slice(0, 120) });
        continue;
      }
      throw e;
    }
  }
  return null;
}

/** @returns {'tinydiarize' | 'stereo' | null} */
function resolveSpeakerLabelMode({
  transcribeSpeakerLabels,
  transcribeStereoDiarize,
  caps,
}) {
  if (!caps) return null;
  const jsonOk = !!(caps.outputJson && caps.outputJsonFull);
  if (transcribeStereoDiarize && caps.stereoDiarize && jsonOk) return 'stereo';
  if (transcribeSpeakerLabels && caps.tinydiarize && jsonOk) return 'tinydiarize';
  return null;
}

// Async entry point. Transcribes a single WAV via whisper-cli and returns
// { text, model, wav, binary, durationMs, txtPath, exitCode, gpu, gpuLayers }.
// Throws on missing preconditions (binary, model, wav) or a non-zero exit
// from whisper-cli.
async function transcribeFile({
  wav,
  model = DEFAULT_MODEL_PATH,
  language = null,
  threads = null,
  noSpeechThreshold = null,
  entropyThreshold = null,
  gpu = null,
  gpuLayers = null,
  binary = null,
  spawnFn = spawn,
  resolveBinaryFn = resolveBinary,
  fsImpl = fs,
  transcribeSpeakerLabels = false,
  transcribeStereoDiarize = false,
  whisperCapabilities = null,
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

  const caps = whisperCapabilities !== undefined && whisperCapabilities !== null
    ? whisperCapabilities
    : getWhisperCliCapabilities(resolvedBinary);

  const wantSpeakers = transcribeSpeakerLabels === true || transcribeStereoDiarize === true;
  const speakerMode = resolveSpeakerLabelMode({
    transcribeSpeakerLabels: transcribeSpeakerLabels === true,
    transcribeStereoDiarize: transcribeStereoDiarize === true,
    caps,
  });

  if (wantSpeakers && !speakerMode) {
    trace('whisper', 'speaker labels unavailable for this whisper-cli build — using plain transcript', {
      transcribeSpeakerLabels,
      transcribeStereoDiarize,
      caps,
    });
  }

  const args = buildWhisperArgs({
    model,
    wav,
    language,
    threads,
    noSpeechThreshold,
    entropyThreshold,
    gpu,
    gpuLayers,
    speakerLabelMode: speakerMode,
  });
  trace('whisper', 'spawn', {
    binary: resolvedBinary,
    args,
    wav,
    model,
    language: language || null,
    gpu,
    gpuLayers,
    speakerLabelMode: speakerMode,
  });
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

  const transcript = readTranscriptFile(wav, fsImpl);
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

  let textOut = transcript.text;
  /** @type {string | null} */
  let jsonPath = null;
  if (speakerMode) {
    const jsonRow = readWhisperJsonFile(wav, fsImpl);
    if (jsonRow) {
      jsonPath = jsonRow.jsonPath;
      const segs = extractSegments(jsonRow.doc);
      const labeled = formatSegmentsAsSpeakerTranscript(segs);
      if (labeled.trim().length > 0) {
        textOut = labeled;
      } else {
        trace('whisper', 'speaker labels empty after parsing JSON; keeping flat .txt', {
          wav,
          segmentCount: segs.length,
        });
      }
    } else {
      trace('whisper', 'speaker mode but JSON missing; keeping flat .txt', {
        tried: expectedJsonPaths(wav),
      });
    }
  }

  trace('whisper', 'success', {
    durationMs,
    txtPath: transcript.txtPath,
    textChars: (textOut || '').length,
    speakerLabelMode: speakerMode,
  });

  return {
    text: textOut,
    model,
    wav,
    language: language != null && String(language).trim() !== '' ? String(language).trim() : null,
    binary: resolvedBinary,
    durationMs,
    txtPath: transcript.txtPath,
    jsonPath,
    speakerLabelMode: speakerMode,
    exitCode,
    // GPU intent that was passed to whisper.cpp. The CLI doesn't echo back
    // whether the GPU was actually used (that would require parsing stderr
    // for "ggml_cuda_init"); callers that need ground-truth runtime info
    // should rely on the trace stream or the bench tool from GPU-5.
    gpu: gpu === true ? true : (gpu === false ? false : null),
    gpuLayers: gpu === true && Number.isInteger(gpuLayers) && gpuLayers > 0 ? gpuLayers : null,
  };
}

module.exports = {
  DEFAULT_MODEL_PATH,
  expectedTxtPaths,
  expectedJsonPaths,
  isWavFile,
  buildWhisperArgs,
  resolveBinary,
  readTranscriptFile,
  readWhisperJsonFile,
  resolveSpeakerLabelMode,
  transcribeFile,
};
