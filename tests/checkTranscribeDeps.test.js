const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  WHISPER_CANDIDATES,
  VENDOR_WHISPER_CUDA_DIR,
  findOnPath,
  pickCandidateBinary,
  parseWhisperHelp,
  printInstallHints,
  vendorBinaryPath,
  resolveWithVendor,
} = require('../tools/check-transcribe-deps');

describe('WHISPER_CANDIDATES', () => {
  test('orders modern names before legacy ones', () => {
    expect(WHISPER_CANDIDATES).toEqual(['whisper-cli', 'whisper', 'main']);
  });
});

describe('parseWhisperHelp', () => {
  test('returns null for empty / non-string input', () => {
    expect(parseWhisperHelp('')).toBeNull();
    expect(parseWhisperHelp(null)).toBeNull();
    expect(parseWhisperHelp(undefined)).toBeNull();
    expect(parseWhisperHelp(42)).toBeNull();
  });

  test('returns null when no line mentions whisper', () => {
    expect(parseWhisperHelp('usage: foo [options]\n  -h, --help\n')).toBeNull();
  });

  test('extracts label + semver when banner contains a version', () => {
    const out = parseWhisperHelp('whisper.cpp 1.7.1\nusage: whisper-cli [options]\n');
    expect(out).toEqual({ label: 'whisper.cpp 1.7.1', version: '1.7.1' });
  });

  test('accepts MAJOR.MINOR versions (some builds drop the patch)', () => {
    const out = parseWhisperHelp('whisper-cli 1.7\n');
    expect(out).toEqual({ label: 'whisper-cli 1.7', version: '1.7' });
  });

  test('returns label with null version when no semver is present', () => {
    const out = parseWhisperHelp('usage: ./main [options] file0.wav file1.wav ...\n  whisper.cpp options:\n');
    expect(out).toEqual({ label: 'whisper.cpp options:', version: null });
  });

  test('tolerates CRLF and leading whitespace', () => {
    const out = parseWhisperHelp('   whisper.cpp 1.6.0   \r\nusage: ...\r\n');
    expect(out).toEqual({ label: 'whisper.cpp 1.6.0', version: '1.6.0' });
  });

  test('only scans the top of the help text (banner zone)', () => {
    const lines = [
      'usage: cli [options]',
      'options:',
      '  -h, --help',
      '  -t N, --threads N',
      '  -m FNAME, --model FNAME',
      '  -f FNAME, --file FNAME',
      '  -otxt, --output-txt',
      '  -ovtt, --output-vtt',
      '  see whisper.cpp 9.9.9 for more',
    ];
    expect(parseWhisperHelp(lines.join('\n'))).toBeNull();
  });
});

describe('pickCandidateBinary', () => {
  function enoent() {
    const err = new Error('not found');
    err.code = 'ENOENT';
    return { ok: false, error: err };
  }

  test('returns the first candidate whose probe is ok', () => {
    const probe = jest.fn((name) => {
      if (name === 'whisper-cli') return enoent();
      if (name === 'whisper') return { ok: true, status: 0, stdout: 'whisper.cpp 1.7.1\n' };
      return enoent();
    });
    const r = pickCandidateBinary(['whisper-cli', 'whisper', 'main'], probe);
    expect(r.picked).toBe('whisper');
    expect(r.result.ok).toBe(true);
    expect(r.attempts.map((a) => a.name)).toEqual(['whisper-cli', 'whisper']);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test('keeps trying after ENOENT and reports no picked when nothing works', () => {
    const probe = jest.fn(() => enoent());
    const r = pickCandidateBinary(['whisper-cli', 'whisper', 'main'], probe);
    expect(r.picked).toBeNull();
    expect(r.result).toBeNull();
    expect(r.attempts).toHaveLength(3);
    expect(r.attempts.every((a) => a.result.error.code === 'ENOENT')).toBe(true);
  });

  test('stops at the first ok (does not over-probe)', () => {
    const probe = jest.fn(() => ({ ok: true, status: 0, stdout: 'whisper-cli\n' }));
    const r = pickCandidateBinary(['whisper-cli', 'whisper', 'main'], probe);
    expect(r.picked).toBe('whisper-cli');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test('keeps trying after a non-ENOENT failure and surfaces it in attempts', () => {
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const probe = jest.fn((name) => {
      if (name === 'whisper-cli') return { ok: false, error: eacces };
      if (name === 'whisper') return { ok: true, status: 0, stdout: '' };
      return enoent();
    });
    const r = pickCandidateBinary(['whisper-cli', 'whisper', 'main'], probe);
    expect(r.picked).toBe('whisper');
    expect(r.attempts[0]).toMatchObject({ name: 'whisper-cli', result: { error: { code: 'EACCES' } } });
  });
});

describe('findOnPath', () => {
  let tmpdir;
  let dirA;
  let dirB;

  beforeAll(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-transcribe-deps-'));
    dirA = path.join(tmpdir, 'a');
    dirB = path.join(tmpdir, 'b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('returns null when PATH is empty', () => {
    expect(findOnPath('whisper-cli', { PATH: '' })).toBeNull();
  });

  test('returns null when nothing matches in any PATH entry', () => {
    const env = { PATH: [dirA, dirB].join(path.delimiter), PATHEXT: '.EXE' };
    expect(findOnPath('whisper-cli', env)).toBeNull();
  });

  test('finds an executable in the first matching directory (Unix-style: no ext)', () => {
    const exe = path.join(dirB, 'whisper-cli');
    fs.writeFileSync(exe, '#!/bin/sh\nexit 0\n');
    // Force a Unix-style lookup regardless of host by clearing PATHEXT and relying on
    // the platform branch only on Windows. To keep the test cross-platform, use a name
    // whose Unix lookup with ext='' succeeds; on Windows we also seed an .EXE.
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dirB, 'whisper-cli.EXE'), 'stub');
    }
    const env = { PATH: [dirA, dirB].join(path.delimiter), PATHEXT: '.EXE' };
    const found = findOnPath('whisper-cli', env);
    expect(found).not.toBeNull();
    expect(found.startsWith(dirB)).toBe(true);
  });

  test('skips PATH entries that do not exist', () => {
    const missing = path.join(tmpdir, 'does-not-exist');
    const env = { PATH: [missing, dirB].join(path.delimiter), PATHEXT: '.EXE' };
    const found = findOnPath('whisper-cli', env);
    expect(found && found.startsWith(dirB)).toBe(true);
  });
});

describe('printInstallHints', () => {
  test('mentions whisper.cpp and the npm script', () => {
    const out = printInstallHints();
    expect(out).toMatch(/whisper\.cpp/i);
    expect(out).toMatch(/npm run transcribe:check/);
  });

  test('platform-specific block includes the expected install vector', () => {
    const out = printInstallHints();
    if (process.platform === 'win32') {
      expect(out).toMatch(/github\.com\/ggerganov\/whisper\.cpp\/releases/);
      expect(out).toMatch(/PATH/);
    } else if (process.platform === 'darwin') {
      expect(out).toMatch(/brew install whisper-cpp/);
    } else {
      expect(out).toMatch(/git clone/);
      expect(out).toMatch(/make/);
    }
  });
});

describe('vendorBinaryPath / resolveWithVendor (GPU-4)', () => {
  let vendorTmp;

  beforeAll(() => {
    vendorTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-vendor-'));
  });

  afterAll(() => {
    fs.rmSync(vendorTmp, { recursive: true, force: true });
  });

  test('VENDOR_WHISPER_CUDA_DIR points under vendor/whisper-cuda relative to cwd', () => {
    // We don't assert the literal path because cwd varies; we assert structure.
    expect(VENDOR_WHISPER_CUDA_DIR.endsWith(path.join('vendor', 'whisper-cuda'))).toBe(true);
  });

  test('vendorBinaryPath returns null when the file does not exist', () => {
    expect(vendorBinaryPath('whisper-cli', { vendorDir: vendorTmp })).toBeNull();
  });

  test('vendorBinaryPath returns absolute path with .exe on win32, no ext elsewhere', () => {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const target = path.join(vendorTmp, `whisper-cli${ext}`);
    fs.writeFileSync(target, 'stub');
    expect(vendorBinaryPath('whisper-cli', { vendorDir: vendorTmp })).toBe(target);
  });

  test('resolveWithVendor prefers a vendor binary that probes ok', () => {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const target = path.join(vendorTmp, `whisper-cli${ext}`);
    fs.writeFileSync(target, 'stub');
    const probe = jest.fn((bin) => bin === target
      ? { ok: true, status: 0, stdout: 'whisper.cpp 1.7.1\n' }
      : { ok: true, status: 0, stdout: 'whisper.cpp from PATH' });
    const out = resolveWithVendor(['whisper-cli'], { probe, vendorDir: vendorTmp });
    expect(out).toBe(target);
    expect(probe).toHaveBeenCalledWith(target);
  });

  test('resolveWithVendor falls through to PATH when vendor file is absent', () => {
    const probe = jest.fn((bin) => bin === 'whisper-cli'
      ? { ok: true, status: 0, stdout: 'whisper.cpp 1.7.1\n' }
      : { ok: false, error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
    const out = resolveWithVendor(['whisper-cli', 'whisper', 'main'], { probe, vendorDir: vendorTmp });
    expect(out).toBe('whisper-cli');
  });

  test('resolveWithVendor falls through to PATH when vendor file exists but probe rejects it', () => {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const target = path.join(vendorTmp, `whisper-cli${ext}`);
    fs.writeFileSync(target, 'stub');
    const probe = jest.fn((bin) => bin === target
      ? { ok: false, error: Object.assign(new Error('exec format error'), { code: 'ENOEXEC' }) }
      : bin === 'whisper-cli'
        ? { ok: true, status: 0, stdout: 'whisper.cpp 1.7.1\n' }
        : { ok: false, error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
    const out = resolveWithVendor(['whisper-cli'], { probe, vendorDir: vendorTmp });
    expect(out).toBe('whisper-cli');
  });

  test('resolveWithVendor returns null when neither vendor nor PATH yield a working binary', () => {
    const probe = jest.fn(() => ({ ok: false, error: Object.assign(new Error('not found'), { code: 'ENOENT' }) }));
    const out = resolveWithVendor(['whisper-cli'], { probe, vendorDir: vendorTmp });
    expect(out).toBeNull();
  });
});
