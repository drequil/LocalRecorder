const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  configPathDefault,
  loadUserConfig,
  effectiveRecordingsRoot,
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

  test('returns null when no file or invalid JSON', () => {
    expect(loadUserConfig({ homedir: path.join(homedir, 'missing') }).recordingsRoot).toBeNull();
    const cfgPath = path.join(homedir, '.localrecorder', 'config.json');
    fs.writeFileSync(cfgPath, '{ not json', 'utf8');
    expect(loadUserConfig({ homedir }).recordingsRoot).toBeNull();
    fs.writeFileSync(cfgPath, JSON.stringify({}), 'utf8');
    expect(loadUserConfig({ homedir }).recordingsRoot).toBeNull();
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
