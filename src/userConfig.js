// Optional JSON config for machine-wide defaults (e.g. recordings root on D:).
// Discovery order:
//   1. LOCALRECORDER_CONFIG — absolute or cwd-relative path to a .json file
//   2. %USERPROFILE%\.localrecorder\config.json (see configPathDefault())
//
// Supported keys (aliases in parentheses):
//   recordingsRoot | recordings_root | root — capture directory
//   transcribeModel | whisperModel | model — default ggml path (relative to cwd ok)
//   transcribeLanguage | whisperLanguage | defaultLanguage — whisper.cpp -l (e.g. en)
//
// CLI always wins over config. --multilingual: multilingual model (models/ggml-base.bin or
// *.en.bin→sibling *.bin); whisper -l omitted unless --language is set (not "auto"), so
// CJK sessions can pass e.g. --language zh while keeping a multilingual checkpoint.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveMultilingualModel } = require('./resolveMultilingualModel');
const { resolvePresetModelAbs, resolveBestAvailableModel } = require('./whisperModelPreset');

const CONFIG_DIR_NAME = '.localrecorder';
const CONFIG_FILE_NAME = 'config.json';

const LANG_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function configPathDefault(homedir = os.homedir()) {
  return path.join(homedir, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

function pickRecordingsRoot(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj.recordingsRoot ?? obj.recordings_root ?? obj.root;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

function pickTranscribeModel(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj.transcribeModel ?? obj.whisperModel ?? obj.model;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

function pickTranscribeLanguage(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj.transcribeLanguage ?? obj.whisperLanguage ?? obj.defaultLanguage;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length === 0 || t.length > 32 || !LANG_RE.test(t)) return null;
  return t;
}

function resolveModelPath(raw, cwd = process.cwd()) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (t.length === 0) return null;
  return path.isAbsolute(t) ? path.normalize(t) : path.resolve(cwd, t);
}

function tryReadConfigObject(configPath, fsImpl = fs) {
  if (!fsImpl.existsSync(configPath)) return null;
  let text;
  try {
    text = fsImpl.readFileSync(configPath, 'utf8');
  } catch (_) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return { data, configPath };
}

/**
 * @returns {{
 *   recordingsRoot: string | null,
 *   transcribeModel: string | null,
 *   transcribeLanguage: string | null,
 *   configPath: string | null,
 * }}
 */
function loadUserConfig({
  homedir = os.homedir(),
  env = process.env,
  fsImpl = fs,
  cwd = process.cwd(),
} = {}) {
  const candidates = [];
  const fromEnv = env.LOCALRECORDER_CONFIG;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    candidates.push(path.resolve(fromEnv.trim()));
  }
  candidates.push(configPathDefault(homedir));

  for (const configPath of candidates) {
    const row = tryReadConfigObject(configPath, fsImpl);
    if (!row) continue;
    const { data } = row;
    const rootRaw = pickRecordingsRoot(data);
    const modelRaw = pickTranscribeModel(data);
    const lang = pickTranscribeLanguage(data);
    return {
      recordingsRoot: rootRaw ? path.normalize(path.isAbsolute(rootRaw) ? rootRaw : path.resolve(cwd, rootRaw)) : null,
      transcribeModel: resolveModelPath(modelRaw, cwd),
      transcribeLanguage: lang,
      configPath: row.configPath,
    };
  }
  return { recordingsRoot: null, transcribeModel: null, transcribeLanguage: null, configPath: null };
}

// No transcribeModel written — at runtime we probe for the best available model.
const DEFAULT_CONFIG_OBJECT = {
  transcribeLanguage: 'en',
};

function ensureDefaultUserConfigIfMissing({ homedir = os.homedir(), fsImpl = fs, log = console.log } = {}) {
  const cfgPath = configPathDefault(homedir);
  if (fsImpl.existsSync(cfgPath)) return { created: false, path: cfgPath };
  fsImpl.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const text = `${JSON.stringify(DEFAULT_CONFIG_OBJECT, null, 2)}\n`;
  fsImpl.writeFileSync(cfgPath, text, 'utf8');
  log(`Created default config: ${cfgPath}`);
  return { created: true, path: cfgPath };
}

function effectiveRecordingsRoot(cliRoot, loadOpts) {
  if (cliRoot != null && String(cliRoot).length > 0) {
    return { root: cliRoot, source: 'cli', configPath: null };
  }
  const cfg = loadUserConfig(loadOpts);
  if (cfg.recordingsRoot) {
    return { root: cfg.recordingsRoot, source: 'config', configPath: cfg.configPath };
  }
  return { root: undefined, source: 'default', configPath: null };
}

/** With --multilingual: optional whisper -l from CLI only; "auto" means omit -l. */
function multilingualWhisperLanguageHint(cliLanguage) {
  if (cliLanguage == null) return null;
  const t = String(cliLanguage).trim();
  if (t.length === 0) return null;
  if (/^auto$/i.test(t)) return null;
  return t;
}

// record / idle: merge default model + language from user config after CLI parse.
async function mergeTranscribeFieldsFromUserConfig(parsed, userCfg = loadUserConfig(), inject = {}) {
  const cwd = inject.cwd != null ? inject.cwd : process.cwd();
  const fsImpl = inject.fsImpl != null ? inject.fsImpl : fs;
  const downloadIfMissing = inject.downloadGgmlBaseBinIfMissing
    || require('./downloadGgmlBaseBin').downloadGgmlBaseBinIfMissing;
  const log = inject.log != null ? inject.log : console.log;

  const multilingual = parsed.multilingual === true;
  if (multilingual) {
    const explicitModel =
      parsed.transcribeModel != null && String(parsed.transcribeModel).trim() !== '';
    const transcribeModel = await resolveMultilingualModel({
      cliModelPath: explicitModel ? parsed.transcribeModel : null,
      preset: explicitModel ? null : parsed.transcribeModelPreset || null,
      cwd,
      fsImpl,
      log,
      downloadGgmlBaseBinIfMissing: downloadIfMissing,
    });
    const transcribeLanguage = multilingualWhisperLanguageHint(parsed.transcribeLanguage);
    return { ...parsed, transcribeModel, transcribeLanguage };
  }

  const explicitModel =
    parsed.transcribeModel != null && String(parsed.transcribeModel).trim() !== '';
  let mergedModel;
  if (explicitModel) {
    mergedModel = parsed.transcribeModel;
  } else if (parsed.transcribeModelPreset === 'medium' || parsed.transcribeModelPreset === 'large') {
    mergedModel = resolvePresetModelAbs(cwd, parsed.transcribeModelPreset);
  } else {
    // No CLI model and no preset: prefer an explicitly configured model, then
    // auto-pick the best model that is already on disk (large-v3 → medium →
    // base.en → base).
    mergedModel = userCfg.transcribeModel || resolveBestAvailableModel(cwd, fsImpl);
  }
  let transcribeLanguage = null;
  if (parsed.transcribeLanguage != null && String(parsed.transcribeLanguage).trim() !== '') {
    transcribeLanguage = String(parsed.transcribeLanguage).trim();
  } else if (userCfg.transcribeLanguage) {
    transcribeLanguage = userCfg.transcribeLanguage;
  }
  return { ...parsed, transcribeModel: mergedModel, transcribeLanguage };
}

module.exports = {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  configPathDefault,
  loadUserConfig,
  effectiveRecordingsRoot,
  ensureDefaultUserConfigIfMissing,
  mergeTranscribeFieldsFromUserConfig,
  multilingualWhisperLanguageHint,
};
