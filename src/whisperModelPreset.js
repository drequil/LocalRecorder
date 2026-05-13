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
  defaultMultilingualBasename,
  resolvePresetModelAbs,
  parsePresetFlags,
};
