const fs = require('fs');
const path = require('path');

const HF_WHISPER_CPP_MODELS = 'https://huggingface.co/ggerganov/whisper.cpp/tree/main';

/** Multilingual ggml filenames under ./models/ for --medium / --large (no --model). */
const TRANSCRIBE_MODEL_PRESET_FILES = {
  medium: 'ggml-medium.bin',
  large: 'ggml-large-v3.bin',
};

function defaultMultilingualBasename(preset) {
  if (preset === 'medium') return TRANSCRIBE_MODEL_PRESET_FILES.medium;
  if (preset === 'large') return TRANSCRIBE_MODEL_PRESET_FILES.large;
  return 'ggml-base.bin';
}

function resolvePresetModelAbs(cwd, preset) {
  if (preset !== 'medium' && preset !== 'large') return null;
  return path.normalize(path.resolve(cwd, 'models', TRANSCRIBE_MODEL_PRESET_FILES[preset]));
}

/**
 * Probe ./models/ in quality order and return the absolute path of the best
 * model that is already on disk.  Falls back to ggml-base.en.bin (the
 * conventional whisper.cpp default) if nothing is found, so callers can still
 * surface a "model not found" error rather than crashing here.
 */
const MODEL_PROBE_ORDER = [
  'ggml-large-v3.bin',
  'ggml-medium.bin',
  'ggml-base.en.bin',
  'ggml-base.bin',
];

const TINYDIARIZE_MODEL_BASENAME = 'ggml-small.en-tdrz.bin';

function resolveBestAvailableModel(cwd = process.cwd(), fsImpl = fs) {
  for (const basename of MODEL_PROBE_ORDER) {
    const abs = path.resolve(cwd, 'models', basename);
    if (fsImpl.existsSync(abs)) return abs;
  }
  return path.resolve(cwd, 'models', 'ggml-base.en.bin');
}

function resolveTinydiarizeModel(cwd = process.cwd(), fsImpl = fs) {
  const abs = path.resolve(cwd, 'models', TINYDIARIZE_MODEL_BASENAME);
  return fsImpl.existsSync(abs) ? abs : null;
}

/** Mutually exclusive --medium / --large → { transcribeModelPreset } or { error }. */
function parsePresetFlags(flags) {
  if (flags.medium === true && flags.large === true) {
    return { error: 'cannot use --medium together with --large' };
  }
  const transcribeModelPreset = flags.medium ? 'medium' : flags.large ? 'large' : null;
  return { transcribeModelPreset };
}

module.exports = {
  HF_WHISPER_CPP_MODELS,
  TRANSCRIBE_MODEL_PRESET_FILES,
  MODEL_PROBE_ORDER,
  TINYDIARIZE_MODEL_BASENAME,
  defaultMultilingualBasename,
  resolvePresetModelAbs,
  parsePresetFlags,
  resolveBestAvailableModel,
  resolveTinydiarizeModel,
};
