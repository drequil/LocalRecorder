// Optional JSON config for machine-wide defaults (e.g. recordings root on D:).
// Discovery order:
//   1. LOCALRECORDER_CONFIG — absolute or cwd-relative path to a .json file
//   2. %USERPROFILE%\.localrecorder\config.json (see configPathDefault())
//
// Supported keys (first match wins per field):
//   recordingsRoot | recordings_root | root — non-empty string, directory for captures

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR_NAME = '.localrecorder';
const CONFIG_FILE_NAME = 'config.json';

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

/**
 * @returns {{ recordingsRoot: string | null, configPath: string | null }}
 */
function loadUserConfig({
  homedir = os.homedir(),
  env = process.env,
  fsImpl = fs,
} = {}) {
  const candidates = [];
  const fromEnv = env.LOCALRECORDER_CONFIG;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    candidates.push(path.resolve(fromEnv.trim()));
  }
  candidates.push(configPathDefault(homedir));

  for (const configPath of candidates) {
    if (!fsImpl.existsSync(configPath)) continue;
    let text;
    try {
      text = fsImpl.readFileSync(configPath, 'utf8');
    } catch (_) {
      continue;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      continue;
    }
    const root = pickRecordingsRoot(data);
    if (root == null) continue;
    return {
      recordingsRoot: path.normalize(root),
      configPath,
    };
  }
  return { recordingsRoot: null, configPath: null };
}

function effectiveRecordingsRoot(cliRoot, loadOpts) {
  if (cliRoot != null && String(cliRoot).length > 0) {
    return { root: cliRoot, source: 'cli', configPath: null };
  }
  const { recordingsRoot, configPath } = loadUserConfig(loadOpts);
  if (recordingsRoot) {
    return { root: recordingsRoot, source: 'config', configPath };
  }
  return { root: undefined, source: 'default', configPath: null };
}

module.exports = {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  configPathDefault,
  loadUserConfig,
  effectiveRecordingsRoot,
};
