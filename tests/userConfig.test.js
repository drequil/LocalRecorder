const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  configPathDefault,
  loadUserConfig,
  effectiveRecordingsRoot,
  mergeTranscribeFieldsFromUserConfig,
  ensureDefaultUserConfigIfMissing,
  multilingualWhisperLanguageHint,
} = require('../src/userConfig');

describe('configPathDefault', () => {
  test('joins homedir with .localrecorder/config.json', () => {
    const p = configPathDefault('C:\\Users\\test');
    expect(p).toBe(path.join('C:\\Users\\test', '.localrecorder', 'config.json'));
  });
});

describe('loadUserConfig', () => {
  const homedir = path.join(os.tmpdir(), 'lr-userconfig-test-home');

  beforeEach(() => {
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.mkdirSync(path.join(homedir, '.localrecorder'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(homedir, { recursive: true, force: true });
  });

  test('reads recordingsRoot from default config path', () => {
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ recordingsRoot: 'D:/captures' }), 'utf8');
    const r = loadUserConfig({ homedir });
    expect(r.recordingsRoot).toBe(path.normalize('D:/captures'));
    expect(r.configPath).toBe(cfgPath);
  });

  test('accepts recordings_root and root aliases', () => {
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ recordings_root: 'E:/a' }), 'utf8');
    expect(loadUserConfig({ homedir }).recordingsRoot).toBe(path.normalize('E:/a'));
    fs.writeFileSync(cfgPath, JSON.stringify({ root: 'E:/b' }), 'utf8');
    expect(loadUserConfig({ homedir }).recordingsRoot).toBe(path.normalize('E:/b'));
  });

  test('LOCALRECORDER_CONFIG wins over default path', () => {
    const custom = path.join(homedir, 'custom.json');
    fs.writeFileSync(custom, JSON.stringify({ recordingsRoot: 'D:/from-env' }), 'utf8');
    const defaultPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ recordingsRoot: 'D:/from-default' }), 'utf8');
    const r = loadUserConfig({
      homedir,
      env: { LOCALRECORDER_CONFIG: custom },
    });
    expect(r.recordingsRoot).toBe(path.normalize('D:/from-env'));
    expect(r.configPath).toBe(path.resolve(custom));
  });

  test('reads transcribeModel and transcribeLanguage without recordingsRoot', () => {
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ transcribeModel: 'D:/models/ggml-base.bin', transcribeLanguage: 'en' }),
      'utf8',
    );
    const r = loadUserConfig({ homedir });
    expect(r.configPath).toBe(cfgPath);
    expect(r.recordingsRoot).toBeNull();
    expect(r.transcribeModel).toBe(path.normalize('D:/models/ggml-base.bin'));
    expect(r.transcribeLanguage).toBe('en');
  });

  test('empty JSON object still yields configPath', () => {
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({}), 'utf8');
    const r = loadUserConfig({ homedir });
    expect(r.configPath).toBe(cfgPath);
    expect(r.recordingsRoot).toBeNull();
    expect(r.transcribeModel).toBeNull();
    expect(r.transcribeLanguage).toBeNull();
  });

  test('returns null configPath when no file or invalid JSON', () => {
    expect(loadUserConfig({ homedir: path.join(homedir, 'missing') }).configPath).toBeNull();
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(cfgPath, '{ not json', 'utf8');
    expect(loadUserConfig({ homedir }).configPath).toBeNull();
  });
});

describe('effectiveRecordingsRoot', () => {
  test('CLI root takes precedence', () => {
    const r = effectiveRecordingsRoot('C:/cli');
    expect(r).toEqual({ root: 'C:/cli', source: 'cli', configPath: null });
  });

  test('uses config when CLI omitted', () => {
    const homedir = path.join(os.tmpdir(), 'lr-effroot-test');
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.mkdirSync(path.join(homedir, '.localrecorder'), { recursive: true });
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ recordingsRoot: 'D:/cfg' }), 'utf8');
    const r = effectiveRecordingsRoot(null, { homedir });
    expect(r.source).toBe('config');
    expect(r.configPath).toBe(cfgPath);
    expect(r.root).toBe(path.normalize('D:/cfg'));
    fs.rmSync(homedir, { recursive: true, force: true });
  });

  test('default when no CLI and no config', () => {
    const homedir = path.join(os.tmpdir(), 'lr-effroot-empty');
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.mkdirSync(homedir, { recursive: true });
    const r = effectiveRecordingsRoot(null, { homedir });
    expect(r).toEqual({ root: undefined, source: 'default', configPath: null });
    fs.rmSync(homedir, { recursive: true, force: true });
  });
});

describe('ensureDefaultUserConfigIfMissing', () => {
  const homedir = path.join(os.tmpdir(), 'lr-ensure-cfg-home');

  beforeEach(() => {
    fs.rmSync(homedir, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(homedir, { recursive: true, force: true });
  });

  test('creates %USERPROFILE%\\.localrecorder\\config.json with defaults when missing', () => {
    const log = jest.fn();
    const r = ensureDefaultUserConfigIfMissing({ homedir, log });
    expect(r.created).toBe(true);
    expect(log).toHaveBeenCalled();
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    // transcribeModel is intentionally omitted so the runtime probe selects
    // the best available model rather than hardcoding ggml-base.en.bin.
    expect(data.transcribeModel).toBeUndefined();
    expect(data.transcribeLanguage).toBe('en');
  });

  test('does not overwrite an existing file', () => {
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, '{"custom":true}', 'utf8');
    const r = ensureDefaultUserConfigIfMissing({ homedir });
    expect(r.created).toBe(false);
    expect(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).custom).toBe(true);
  });
});

describe('multilingualWhisperLanguageHint', () => {
  test('returns null for missing, blank, or auto', () => {
    expect(multilingualWhisperLanguageHint(null)).toBeNull();
    expect(multilingualWhisperLanguageHint('')).toBeNull();
    expect(multilingualWhisperLanguageHint('  ')).toBeNull();
    expect(multilingualWhisperLanguageHint('auto')).toBeNull();
    expect(multilingualWhisperLanguageHint('AUTO')).toBeNull();
  });

  test('returns trimmed code otherwise', () => {
    expect(multilingualWhisperLanguageHint(' zh ')).toBe('zh');
    expect(multilingualWhisperLanguageHint('hi')).toBe('hi');
  });
});

describe('mergeTranscribeFieldsFromUserConfig', () => {
  test('fills model and language from user config', async () => {
    const userCfg = {
      recordingsRoot: null,
      transcribeModel: path.normalize('D:/models/ggml-base.bin'),
      transcribeLanguage: 'en',
      configPath: 'D:/x.json',
    };
    const out = await mergeTranscribeFieldsFromUserConfig(
      { transcribeModel: null, transcribeLanguage: null, multilingual: false },
      userCfg,
    );
    expect(out.transcribeModel).toBe(path.normalize('D:/models/ggml-base.bin'));
    expect(out.transcribeLanguage).toBe('en');
  });

  test('CLI model and language win over config', async () => {
    const userCfg = {
      recordingsRoot: null,
      transcribeModel: path.normalize('D:/cfg/model.bin'),
      transcribeLanguage: 'en',
      configPath: null,
    };
    const out = await mergeTranscribeFieldsFromUserConfig(
      {
        transcribeModel: path.normalize('D:/cli/model.bin'),
        transcribeLanguage: 'hi',
        multilingual: false,
      },
      userCfg,
    );
    expect(out.transcribeModel).toBe(path.normalize('D:/cli/model.bin'));
    expect(out.transcribeLanguage).toBe('hi');
  });

  test('--multilingual uses models/ggml-base.bin and invokes download helper', async () => {
    const userCfg = {
      recordingsRoot: null,
      transcribeModel: path.normalize('D:/cfg/en.bin'),
      transcribeLanguage: 'en',
      configPath: null,
    };
    const dl = jest.fn().mockResolvedValue({ downloaded: true, path: 'x' });
    const cwd = path.join(os.tmpdir(), 'lr-ml-merge-cwd');
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    const out = await mergeTranscribeFieldsFromUserConfig(
      { transcribeModel: null, transcribeLanguage: null, multilingual: true },
      userCfg,
      { cwd, downloadGgmlBaseBinIfMissing: dl, log: jest.fn() },
    );
    expect(out.transcribeLanguage).toBeNull();
    expect(out.transcribeModel).toBe(path.normalize(path.join(cwd, 'models', 'ggml-base.bin')));
    expect(dl).toHaveBeenCalledWith(path.join(cwd, 'models', 'ggml-base.bin'), expect.any(Object));
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('--multilingual with explicit transcribeModel skips download when file exists', async () => {
    const dl = jest.fn();
    const tmp = path.join(os.tmpdir(), `lr-ml-custom-${Date.now()}.bin`);
    fs.writeFileSync(tmp, 'x');
    try {
      const out = await mergeTranscribeFieldsFromUserConfig(
        { transcribeModel: tmp, transcribeLanguage: null, multilingual: true },
        {},
        { cwd: 'C:\\proj', downloadGgmlBaseBinIfMissing: dl },
      );
      expect(out.transcribeModel).toBe(path.normalize(tmp));
      expect(out.transcribeLanguage).toBeNull();
      expect(dl).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test('--multilingual with *.en.bin maps to sibling .bin and invokes download for ggml-base.bin', async () => {
    const dl = jest.fn().mockResolvedValue({});
    const out = await mergeTranscribeFieldsFromUserConfig(
      { transcribeModel: 'D:/models/ggml-base.en.bin', transcribeLanguage: null, multilingual: true },
      {},
      { cwd: 'C:\\proj', downloadGgmlBaseBinIfMissing: dl },
    );
    expect(out.transcribeModel).toBe(path.normalize('D:/models/ggml-base.bin'));
    expect(out.transcribeLanguage).toBeNull();
    expect(dl).toHaveBeenCalledWith(path.normalize('D:/models/ggml-base.bin'), expect.any(Object));
  });

  test('non-multilingual --medium preset resolves under cwd/models (overrides config model)', async () => {
    const cwd = path.join(os.tmpdir(), `lr-merge-med-${Date.now()}`);
    fs.mkdirSync(cwd, { recursive: true });
    try {
      const userCfg = {
        recordingsRoot: null,
        transcribeModel: path.normalize('D:/cfg/ignored.bin'),
        transcribeLanguage: 'en',
        configPath: null,
      };
      const out = await mergeTranscribeFieldsFromUserConfig(
        {
          transcribeModel: null,
          transcribeLanguage: null,
          multilingual: false,
          transcribeModelPreset: 'medium',
        },
        userCfg,
        { cwd },
      );
      expect(out.transcribeModel).toBe(path.normalize(path.join(cwd, 'models', 'ggml-medium.bin')));
      expect(out.transcribeLanguage).toBe('en');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('--multilingual with preset medium uses ggml-medium.bin when file exists', async () => {
    const dl = jest.fn();
    const cwd = path.join(os.tmpdir(), `lr-ml-preset-${Date.now()}`);
    fs.mkdirSync(path.join(cwd, 'models'), { recursive: true });
    const med = path.join(cwd, 'models', 'ggml-medium.bin');
    fs.writeFileSync(med, 'x');
    try {
      const out = await mergeTranscribeFieldsFromUserConfig(
        {
          transcribeModel: null,
          transcribeLanguage: null,
          multilingual: true,
          transcribeModelPreset: 'medium',
        },
        {},
        { cwd, downloadGgmlBaseBinIfMissing: dl, log: jest.fn() },
      );
      expect(out.transcribeModel).toBe(path.normalize(med));
      expect(dl).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('--multilingual keeps CLI --language as whisper hint (e.g. zh)', async () => {
    const dl = jest.fn().mockResolvedValue({});
    const cwd = path.join(os.tmpdir(), 'lr-ml-zh-cwd');
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    try {
      const out = await mergeTranscribeFieldsFromUserConfig(
        { transcribeModel: null, transcribeLanguage: 'zh', multilingual: true },
        {},
        { cwd, downloadGgmlBaseBinIfMissing: dl, log: jest.fn() },
      );
      expect(out.transcribeLanguage).toBe('zh');
      expect(out.transcribeModel).toBe(path.normalize(path.join(cwd, 'models', 'ggml-base.bin')));
      expect(dl).toHaveBeenCalled();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('no model set: probes filesystem and returns best available', async () => {
    const cwd = 'D:/proj';
    const fsImpl = {
      existsSync: (p) => p.includes('ggml-large-v3.bin'),
    };
    const out = await mergeTranscribeFieldsFromUserConfig(
      { transcribeModel: null, transcribeLanguage: null, multilingual: false, transcribeModelPreset: null },
      { transcribeModel: null, transcribeLanguage: null, configPath: null, recordingsRoot: null },
      { cwd, fsImpl },
    );
    expect(out.transcribeModel).toBe(path.normalize(path.resolve(cwd, 'models', 'ggml-large-v3.bin')));
  });

  test('no model set, only base.en on disk: falls back to base.en', async () => {
    const cwd = 'D:/proj';
    const fsImpl = {
      existsSync: (p) => p.includes('ggml-base.en.bin'),
    };
    const out = await mergeTranscribeFieldsFromUserConfig(
      { transcribeModel: null, transcribeLanguage: null, multilingual: false, transcribeModelPreset: null },
      { transcribeModel: null, transcribeLanguage: null, configPath: null, recordingsRoot: null },
      { cwd, fsImpl },
    );
    expect(out.transcribeModel).toBe(path.normalize(path.resolve(cwd, 'models', 'ggml-base.en.bin')));
  });

  test('--multilingual treats CLI --language auto as omit whisper -l', async () => {
    const dl = jest.fn().mockResolvedValue({});
    const cwd = path.join(os.tmpdir(), 'lr-ml-auto-cwd');
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    try {
      const out = await mergeTranscribeFieldsFromUserConfig(
        { transcribeModel: null, transcribeLanguage: 'auto', multilingual: true },
        {},
        { cwd, downloadGgmlBaseBinIfMissing: dl, log: jest.fn() },
      );
      expect(out.transcribeLanguage).toBeNull();
      expect(dl).toHaveBeenCalled();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
