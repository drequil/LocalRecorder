const path = require('path');
const fs = require('fs');
const { defaultMultilingualBasename, HF_WHISPER_CPP_MODELS } = require('./whisperModelPreset');

/**
 * Whisper English-only checkpoints are named *.en.bin. Multilingual siblings use the
 * same stem with .bin (e.g. ggml-base.en.bin → ggml-base.bin in the same folder).
 */
function enModelPathToMultilingualSibling(absModelPath) {
  const norm = path.normalize(absModelPath);
  if (/\.en\.bin$/i.test(norm)) {
    return path.normalize(norm.replace(/\.en\.bin$/i, '.bin'));
  }
  return path.normalize(norm);
}

function resolveModelPath(raw, cwd = process.cwd()) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (t.length === 0) return null;
  return path.isAbsolute(t) ? path.normalize(t) : path.resolve(cwd, t);
}

/**
 * Pick the ggml file used when --multilingual is set.
 * - No --model: cwd/models/ggml-base.bin (download if missing), or ggml-medium.bin /
 *   ggml-large-v3.bin when preset is medium/large.
 * - --model path to *.en.bin: same directory, stem .bin (e.g. ggml-base.bin); download only for ggml-base.bin.
 * - --model path to other .bin: use as-is; must exist (no HF download).
 */
async function resolveMultilingualModel({
  cliModelPath = null,
  preset = null,
  cwd = process.cwd(),
  fsImpl = fs,
  log = console.log,
  downloadGgmlBaseBinIfMissing,
} = {}) {
  const dl = downloadGgmlBaseBinIfMissing
    || require('./downloadGgmlBaseBin').downloadGgmlBaseBinIfMissing;

  let target;
  if (cliModelPath != null && String(cliModelPath).trim() !== '') {
    const abs = resolveModelPath(cliModelPath, cwd);
    target = enModelPathToMultilingualSibling(abs);
  } else {
    const baseName = defaultMultilingualBasename(preset);
    target = path.normalize(path.resolve(cwd, 'models', baseName));
  }

  const base = path.basename(target);
  if (base.toLowerCase() === 'ggml-base.bin') {
    await dl(target, { fsImpl, log });
    return path.normalize(target);
  }

  if (!fsImpl.existsSync(target)) {
    const hint =
      cliModelPath != null && /\.en\.bin$/i.test(resolveModelPath(cliModelPath, cwd))
        ? 'Your --model pointed at an English-only .en.bin file; --multilingual uses the multilingual .bin in the same folder (e.g. ggml-base.bin next to ggml-base.en.bin).'
        : `Place that file on disk or pass --model to a multilingual whisper .bin checkpoint.\n  Downloads: ${HF_WHISPER_CPP_MODELS}`;
    throw new Error(`Multilingual model not found:\n  ${target}\n  ${hint}`);
  }
  return path.normalize(target);
}

module.exports = {
  enModelPathToMultilingualSibling,
  resolveMultilingualModel,
  resolveModelPath,
};
