const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const {
  DEFAULT_MODEL_PATH,
  expectedTxtPaths,
  isWavFile,
  buildWhisperArgs,
  resolveBinary,
  readTranscriptFile,
  transcribeFile,
} = require('../src/transcribe');

// Minimal RIFF/WAVE header: 'RIFF', 4 bytes size, 'WAVE'. The first 12 bytes is all
// isWavFile() inspects, so the rest of the file content is irrelevant for that probe.
function writeFakeWav(filePath, { bodyBytes = 32 } = {}) {
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + bodyBytes, 4);
  header.write('WAVE', 8, 'ascii');
  const body = Buffer.alloc(bodyBytes);
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

// Fake spawn that lets each test pin exit code, stdout/stderr data, and optional error.
function makeFakeSpawn({ exitCode = 0, stdoutData = '', stderrData = '', error = null } = {}) {
  const fake = jest.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      if (stdoutData) child.stdout.emit('data', Buffer.from(stdoutData));
      if (stderrData) child.stderr.emit('data', Buffer.from(stderrData));
      child.emit('close', exitCode);
    });
    return child;
  });
  return fake;
}

describe('DEFAULT_MODEL_PATH', () => {
  test('points at the conventional ggml-base.en.bin under models/', () => {
    expect(DEFAULT_MODEL_PATH).toBe(path.join('models', 'ggml-base.en.bin'));
  });
});

describe('expectedTxtPaths', () => {
  test('returns the strip-ext candidate first, the append-ext candidate second', () => {
    const out = expectedTxtPaths(path.join('dir', 'hello.wav'));
    expect(out[0]).toBe(path.join('dir', 'hello.txt'));
    expect(out[1]).toBe(path.join('dir', 'hello.wav.txt'));
  });

  test('preserves multi-dot basenames (only the last extension is stripped)', () => {
    const out = expectedTxtPaths(path.join('dir', 'chunk-20260512.wav'));
    expect(out[0]).toBe(path.join('dir', 'chunk-20260512.txt'));
    expect(out[1]).toBe(path.join('dir', 'chunk-20260512.wav.txt'));
  });

  test('throws on empty / non-string input', () => {
    expect(() => expectedTxtPaths('')).toThrow(/non-empty string/);
    expect(() => expectedTxtPaths(null)).toThrow(/non-empty string/);
    expect(() => expectedTxtPaths(42)).toThrow(/non-empty string/);
  });
});

describe('isWavFile', () => {
  let tmpdir;

  beforeAll(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-transcribe-iswav-'));
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('returns true for a real RIFF/WAVE header', () => {
    const p = path.join(tmpdir, 'real.wav');
    writeFakeWav(p);
    expect(isWavFile(p)).toBe(true);
  });

  test('returns false for a file with wrong magic', () => {
    const p = path.join(tmpdir, 'notwav.bin');
    fs.writeFileSync(p, Buffer.from('this is plainly not a wav file at all here'));
    expect(isWavFile(p)).toBe(false);
  });

  test('returns false for a file shorter than the 12-byte header', () => {
    const p = path.join(tmpdir, 'tiny.bin');
    fs.writeFileSync(p, Buffer.from('RIFF'));
    expect(isWavFile(p)).toBe(false);
  });

  test('returns false for a file that does not exist', () => {
    expect(isWavFile(path.join(tmpdir, 'nope.wav'))).toBe(false);
  });

  test('returns false for RIFF + wrong form (e.g. RIFF...AVI )', () => {
    const p = path.join(tmpdir, 'avi.bin');
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0, 'ascii');
    buf.write('AVI ', 8, 'ascii');
    fs.writeFileSync(p, buf);
    expect(isWavFile(p)).toBe(false);
  });
});

describe('buildWhisperArgs', () => {
  test('produces the canonical T-2 arg order', () => {
    const out = buildWhisperArgs({ model: 'm.bin', wav: 'a.wav' });
    expect(out).toEqual(['--no-prints', '--output-txt', '-m', 'm.bin', '-f', 'a.wav']);
  });

  test('inserts -l <code> before -f when language is set', () => {
    const out = buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', language: 'hi' });
    expect(out).toEqual(['--no-prints', '--output-txt', '-m', 'm.bin', '-l', 'hi', '-f', 'a.wav']);
  });

  test('omits -l when language is null or blank', () => {
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', language: null }))
      .toEqual(['--no-prints', '--output-txt', '-m', 'm.bin', '-f', 'a.wav']);
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', language: '  ' }))
      .toEqual(['--no-prints', '--output-txt', '-m', 'm.bin', '-f', 'a.wav']);
  });

  test('inserts -t N after -m when threads is a positive integer', () => {
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', threads: 8 }))
      .toEqual(['--no-prints', '--output-txt', '-m', 'm.bin', '-t', '8', '-f', 'a.wav']);
  });

  test('inserts -t before -l when both are set', () => {
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', threads: 4, language: 'zh' }))
      .toEqual(['--no-prints', '--output-txt', '-m', 'm.bin', '-t', '4', '-l', 'zh', '-f', 'a.wav']);
  });

  test('omits -t when threads is null, 0, or non-integer', () => {
    const base = ['--no-prints', '--output-txt', '-m', 'm.bin', '-f', 'a.wav'];
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', threads: null })).toEqual(base);
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', threads: 0 })).toEqual(base);
    expect(buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', threads: 2.5 })).toEqual(base);
  });

  test('throws on missing model', () => {
    expect(() => buildWhisperArgs({ wav: 'a.wav' })).toThrow(/model is required/);
  });

  test('throws on missing wav', () => {
    expect(() => buildWhisperArgs({ model: 'm.bin' })).toThrow(/wav is required/);
  });
});

describe('resolveBinary', () => {
  test('returns the picked candidate when probe succeeds for one name', () => {
    const probe = jest.fn((name) => name === 'whisper-cli'
      ? { ok: true, status: 0, stdout: 'whisper.cpp 1.7.1\n' }
      : { ok: false, error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
    expect(resolveBinary({ probe })).toBe('whisper-cli');
  });

  test('returns null when every probe fails with ENOENT', () => {
    const probe = jest.fn(() => ({
      ok: false,
      error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
    }));
    expect(resolveBinary({ probe })).toBeNull();
  });
});

describe('readTranscriptFile', () => {
  let tmpdir;

  beforeAll(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-transcribe-readtxt-'));
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('reads the modern strip-ext candidate when it exists', () => {
    const wav = path.join(tmpdir, 'hello.wav');
    writeFakeWav(wav);
    fs.writeFileSync(path.join(tmpdir, 'hello.txt'), '  this is a test \n');
    const out = readTranscriptFile(wav);
    expect(out).toEqual({
      text: 'this is a test',
      txtPath: path.join(tmpdir, 'hello.txt'),
    });
  });

  test('falls back to the append-ext candidate when only that one exists', () => {
    const wav = path.join(tmpdir, 'legacy.wav');
    writeFakeWav(wav);
    fs.writeFileSync(`${wav}.txt`, 'legacy convention output\n');
    const out = readTranscriptFile(wav);
    expect(out).toEqual({
      text: 'legacy convention output',
      txtPath: `${wav}.txt`,
    });
  });

  test('returns null when neither candidate exists', () => {
    const wav = path.join(tmpdir, 'no-output.wav');
    writeFakeWav(wav);
    expect(readTranscriptFile(wav)).toBeNull();
  });
});

describe('transcribeFile', () => {
  let tmpdir;
  let wav;
  let model;

  beforeAll(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-transcribe-end-'));
    wav = path.join(tmpdir, 'sample.wav');
    model = path.join(tmpdir, 'fake-model.bin');
    writeFakeWav(wav);
    fs.writeFileSync(model, 'not really a model, just a placeholder');
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('happy path: returns the expected shape with text read from the .txt sibling', async () => {
    fs.writeFileSync(path.join(tmpdir, 'sample.txt'), 'hello from whisper\n');
    const spawnFn = makeFakeSpawn({ exitCode: 0 });

    const out = await transcribeFile({
      wav,
      model,
      binary: 'whisper-cli',
      spawnFn,
    });

    expect(out.text).toBe('hello from whisper');
    expect(out.model).toBe(model);
    expect(out.wav).toBe(wav);
    expect(out.language).toBeNull();
    expect(out.binary).toBe('whisper-cli');
    expect(out.exitCode).toBe(0);
    expect(out.txtPath).toBe(path.join(tmpdir, 'sample.txt'));
    expect(typeof out.durationMs).toBe('number');
    expect(out.durationMs).toBeGreaterThanOrEqual(0);

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [actualBinary, actualArgs] = spawnFn.mock.calls[0];
    expect(actualBinary).toBe('whisper-cli');
    expect(actualArgs).toEqual(['--no-prints', '--output-txt', '-m', model, '-f', wav]);
  });

  test('passes -l to whisper-cli when language is set', async () => {
    fs.writeFileSync(path.join(tmpdir, 'sample.txt'), 'नमस्ते\n');
    const spawnFn = makeFakeSpawn({ exitCode: 0 });

    await transcribeFile({
      wav,
      model,
      language: 'hi',
      binary: 'whisper-cli',
      spawnFn,
    });

    const [, actualArgs] = spawnFn.mock.calls[0];
    expect(actualArgs).toEqual(['--no-prints', '--output-txt', '-m', model, '-l', 'hi', '-f', wav]);
  });

  test('throws when wav is missing', async () => {
    await expect(transcribeFile({
      wav: path.join(tmpdir, 'does-not-exist.wav'),
      model,
      binary: 'whisper-cli',
    })).rejects.toThrow(/WAV file not found/);
  });

  test('throws when wav lacks RIFF/WAVE magic', async () => {
    const fakeWav = path.join(tmpdir, 'fake.wav');
    fs.writeFileSync(fakeWav, 'this is not a wav file at all by content');
    await expect(transcribeFile({
      wav: fakeWav,
      model,
      binary: 'whisper-cli',
    })).rejects.toThrow(/not a WAV file/);
  });

  test('throws when model is missing', async () => {
    await expect(transcribeFile({
      wav,
      model: path.join(tmpdir, 'no-model.bin'),
      binary: 'whisper-cli',
    })).rejects.toThrow(/model file not found/);
  });

  test('throws when no whisper.cpp binary is on PATH', async () => {
    const resolveBinaryFn = jest.fn(() => null);
    await expect(transcribeFile({
      wav,
      model,
      resolveBinaryFn,
    })).rejects.toThrow(/no whisper\.cpp CLI found on PATH/);
    expect(resolveBinaryFn).toHaveBeenCalledTimes(1);
  });

  test('throws with exitCode + stderr when whisper-cli exits non-zero', async () => {
    const spawnFn = makeFakeSpawn({ exitCode: 1, stderrData: 'whisper-cli: fatal error\nbad model\n' });
    try {
      await transcribeFile({ wav, model, binary: 'whisper-cli', spawnFn });
      throw new Error('expected transcribeFile to reject');
    } catch (err) {
      expect(err.message).toMatch(/exited with code 1/);
      expect(err.exitCode).toBe(1);
      expect(err.stderr).toMatch(/fatal error/);
    }
  });

  test('throws when whisper-cli exits 0 but produces no .txt', async () => {
    // Use a fresh wav whose .txt sibling does not exist.
    const lonelyWav = path.join(tmpdir, 'no-output-here.wav');
    writeFakeWav(lonelyWav);
    const spawnFn = makeFakeSpawn({ exitCode: 0 });
    await expect(transcribeFile({
      wav: lonelyWav,
      model,
      binary: 'whisper-cli',
      spawnFn,
    })).rejects.toThrow(/produced no .txt output/);
  });

  test('propagates spawn errors (e.g. ENOENT after binary discovery raced with a delete)', async () => {
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const spawnFn = makeFakeSpawn({ error: enoent });
    await expect(transcribeFile({
      wav,
      model,
      binary: 'whisper-cli',
      spawnFn,
    })).rejects.toThrow(/ENOENT/);
  });
});
