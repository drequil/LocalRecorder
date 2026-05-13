const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  enModelPathToMultilingualSibling,
  resolveMultilingualModel,
} = require('../src/resolveMultilingualModel');

describe('enModelPathToMultilingualSibling', () => {
  test('maps .en.bin to .bin in same directory', () => {
    expect(enModelPathToMultilingualSibling('D:/m/ggml-base.en.bin')).toBe(
      path.normalize('D:/m/ggml-base.bin'),
    );
    expect(enModelPathToMultilingualSibling('D:/m/ggml-small.en.bin')).toBe(
      path.normalize('D:/m/ggml-small.bin'),
    );
  });

  test('leaves non-.en.bin paths unchanged', () => {
    expect(enModelPathToMultilingualSibling('D:/m/ggml-base.bin')).toBe(path.normalize('D:/m/ggml-base.bin'));
  });
});

describe('resolveMultilingualModel', () => {
  test('downloads default cwd/models/ggml-base.bin when no CLI model', async () => {
    const dl = jest.fn().mockResolvedValue({});
    const cwd = path.join(os.tmpdir(), `lr-rmm-${Date.now()}`);
    fs.mkdirSync(path.join(cwd, 'models'), { recursive: true });
    try {
      const p = await resolveMultilingualModel({
        cliModelPath: null,
        cwd,
        log: jest.fn(),
        downloadGgmlBaseBinIfMissing: dl,
      });
      expect(p).toBe(path.join(cwd, 'models', 'ggml-base.bin'));
      expect(dl).toHaveBeenCalledWith(path.join(cwd, 'models', 'ggml-base.bin'), expect.any(Object));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('throws when non-base multilingual path is missing', async () => {
    const missing = path.join(os.tmpdir(), `lr-rmm-miss-${Date.now()}.bin`);
    await expect(
      resolveMultilingualModel({
        cliModelPath: missing,
        cwd: process.cwd(),
        fsImpl: fs,
        log: jest.fn(),
        downloadGgmlBaseBinIfMissing: jest.fn(),
      }),
    ).rejects.toThrow(/Multilingual model not found/);
  });

  test('preset medium uses ggml-medium.bin without download helper', async () => {
    const dl = jest.fn();
    const cwd = path.join(os.tmpdir(), `lr-rmm-med-${Date.now()}`);
    fs.mkdirSync(path.join(cwd, 'models'), { recursive: true });
    const med = path.join(cwd, 'models', 'ggml-medium.bin');
    fs.writeFileSync(med, 'mock');
    try {
      const p = await resolveMultilingualModel({
        cliModelPath: null,
        preset: 'medium',
        cwd,
        log: jest.fn(),
        downloadGgmlBaseBinIfMissing: dl,
      });
      expect(p).toBe(path.normalize(med));
      expect(dl).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
