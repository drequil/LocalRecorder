jest.mock('node-record-lpcm16', () => {
  const factory = {
    record: jest.fn(() => {
      const stream = {
        pipe: jest.fn(),
        on: jest.fn(),
      };
      const recording = {
        stream: jest.fn(() => stream),
        stop: jest.fn(),
        on: jest.fn(),
      };
      recording.__stream = stream;
      factory.__lastRecording = recording;
      return recording;
    }),
    __lastRecording: null,
  };
  return factory;
});

jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({
    end: jest.fn(),
    on: jest.fn(),
    write: jest.fn(),
  })),
  mkdirSync: jest.fn(),
}));

const recorderLib = require('node-record-lpcm16');
const fs = require('fs');
const AudioRecorder = require('../src/audioRecorder');

describe('AudioRecorder', () => {
  let recorder;

  beforeEach(() => {
    jest.clearAllMocks();
    recorderLib.__lastRecording = null;
    recorder = new AudioRecorder();
  });

  test('creates instance with default options', () => {
    expect(recorder).toBeInstanceOf(AudioRecorder);
    expect(recorder.options.sampleRate).toBe(16000);
    expect(recorder.options.channels).toBe(1);
  });

  test('merges user options over defaults', () => {
    const custom = new AudioRecorder({ sampleRate: 44100 });
    expect(custom.options.sampleRate).toBe(44100);
    expect(custom.options.channels).toBe(1);
  });

  test('start() opens write stream and begins recording in WAV mode', () => {
    expect(() => recorder.start('test.wav')).not.toThrow();
    expect(fs.createWriteStream).toHaveBeenCalledWith('test.wav');
    expect(recorderLib.record).toHaveBeenCalledWith(
      expect.objectContaining({ ...recorder.options, audioType: 'wav' }),
    );
    expect(recorderLib.__lastRecording.__stream.pipe).toHaveBeenCalled();
  });

  test('start() registers a stream error handler that closes the file on error', () => {
    recorder.start('test.wav');
    const stream = recorderLib.__lastRecording.__stream;
    const errorReg = stream.on.mock.calls.find(([event]) => event === 'error');
    expect(errorReg).toBeDefined();

    const fileStream = recorder.fileStream;
    errorReg[1](new Error('boom'));
    expect(recorder.recording).toBeNull();
    expect(recorder.fileStream).toBeNull();
    expect(fileStream.end).toHaveBeenCalled();
  });

  test('start() stream error after stop() stays silent and is a no-op', () => {
    recorder.start('test.wav');
    const stream = recorderLib.__lastRecording.__stream;
    const errorReg = stream.on.mock.calls.find(([event]) => event === 'error');
    expect(errorReg).toBeDefined();

    recorder.stop();
    const fsEndCalls = recorder.fileStream;
    expect(fsEndCalls).toBeNull();

    expect(() => errorReg[1](new Error('post-stop'))).not.toThrow();
  });

  test('start() throws when already recording', () => {
    recorder.start('test.wav');
    expect(() => recorder.start('test2.wav')).toThrow('Recording already in progress');
  });

  test('stop() halts recording and clears state', () => {
    recorder.start('test.wav');
    const lastRecording = recorderLib.__lastRecording;
    expect(() => recorder.stop()).not.toThrow();
    expect(lastRecording.stop).toHaveBeenCalled();
    expect(recorder.recording).toBeNull();
    expect(recorder.fileStream).toBeNull();
  });

  test('stop() throws when not recording', () => {
    expect(() => recorder.stop()).toThrow('No recording in progress');
  });

  test('idleListen() ensures the target directory exists and writes a chunk WAV inside it', () => {
    expect(() => recorder.idleListen('./recordings')).not.toThrow();
    expect(fs.mkdirSync).toHaveBeenCalledWith('./recordings', { recursive: true });

    expect(fs.createWriteStream).toHaveBeenCalledTimes(1);
    const writeArg = fs.createWriteStream.mock.calls[0][0];
    expect(writeArg).toMatch(/[\\\/]chunk-\d{8}-\d{6}-\d{3}\.wav$/);
    expect(writeArg.startsWith('recordings') || writeArg.includes('recordings')).toBe(true);

    expect(recorderLib.record).toHaveBeenCalled();
    const lastCall = recorderLib.record.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({
      audioType: 'wav',
      endOnSilence: true,
      threshold: 0.1,
      silence: '2',
    });
  });

  test('idleListen() honors idleThreshold / idleSilenceSeconds constructor overrides', () => {
    const custom = new AudioRecorder({ idleThreshold: 0.01, idleSilenceSeconds: 2.5 });
    custom.idleListen('./recordings');
    const lastCall = recorderLib.record.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({ threshold: 0.01, silence: '2.5' });
    expect(lastCall.idleThreshold).toBeUndefined();
    expect(lastCall.idleSilenceSeconds).toBeUndefined();
  });

  test('idleListen() kills the current chunk after maxChunkSeconds when set', () => {
    jest.useFakeTimers();
    try {
      const custom = new AudioRecorder({ maxChunkSeconds: 5 });
      custom.idleListen('./recordings');
      const firstRecording = recorderLib.__lastRecording;
      expect(firstRecording.stop).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5000);
      expect(firstRecording.stop).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('idleListen() does NOT install a max-chunk timer when maxChunkSeconds is absent or 0', () => {
    jest.useFakeTimers();
    try {
      const custom = new AudioRecorder();
      custom.idleListen('./recordings');
      const firstRecording = recorderLib.__lastRecording;
      jest.advanceTimersByTime(60000);
      expect(firstRecording.stop).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('idleListen() clears the max-chunk timer when the stream ends naturally', () => {
    jest.useFakeTimers();
    try {
      const custom = new AudioRecorder({ maxChunkSeconds: 5 });
      custom.idleListen('./recordings');
      const stream = recorderLib.__lastRecording.__stream;
      const firstRecording = recorderLib.__lastRecording;

      const endHandler = stream.on.mock.calls.find(([event]) => event === 'end');
      expect(endHandler).toBeDefined();
      endHandler[1]();

      jest.advanceTimersByTime(10000);
      // First recording's stop should not be called by the timer (timer was cleared).
      expect(firstRecording.stop).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('idleListen() rotates to a new chunk file on each silence event', () => {
    jest.useFakeTimers();
    try {
      recorder.idleListen('./recordings');
      const firstPath = fs.createWriteStream.mock.calls[0][0];

      const firstStream = recorderLib.__lastRecording.__stream;
      const endHandler = firstStream.on.mock.calls.find(([event]) => event === 'end');
      expect(endHandler).toBeDefined();
      endHandler[1]();

      jest.advanceTimersByTime(150);

      expect(fs.createWriteStream).toHaveBeenCalledTimes(2);
      const secondPath = fs.createWriteStream.mock.calls[1][0];
      expect(secondPath).not.toBe(firstPath);
      expect(secondPath).toMatch(/[\\\/]chunk-\d{8}-\d{6}-\d{3}(?:-\d+)?\.wav$/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('idleListen() auto-restarts on a sox stream error (exit code null crash)', () => {
    jest.useFakeTimers();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      recorder.idleListen('./recordings');
      const firstPath = fs.createWriteStream.mock.calls[0][0];

      const firstStream = recorderLib.__lastRecording.__stream;
      const errorHandler = firstStream.on.mock.calls.find(([event]) => event === 'error');
      expect(errorHandler).toBeDefined();
      errorHandler[1](new Error('sox has exited with error code null'));

      jest.advanceTimersByTime(600);

      // A second chunk should have been started.
      expect(fs.createWriteStream).toHaveBeenCalledTimes(2);
      const secondPath = fs.createWriteStream.mock.calls[1][0];
      expect(secondPath).not.toBe(firstPath);
      // Idle flag must still be true (session not aborted).
      expect(recorder.idle).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('restarting'));
    } finally {
      jest.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  test('idleListen() does NOT restart on error after stop()', () => {
    jest.useFakeTimers();
    try {
      recorder.idleListen('./recordings');
      const stream = recorderLib.__lastRecording.__stream;
      const errorHandler = stream.on.mock.calls.find(([event]) => event === 'error');
      expect(errorHandler).toBeDefined();

      recorder.stop();
      recorderLib.record.mockClear();
      fs.createWriteStream.mockClear();

      // Error fires after stop() -- should be silently ignored.
      errorHandler[1](new Error('sox has exited with error code null'));
      jest.advanceTimersByTime(600);

      expect(recorderLib.record).not.toHaveBeenCalled();
      expect(recorder.idle).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('idleListen() requires a non-empty directory argument', () => {
    expect(() => recorder.idleListen()).toThrow(TypeError);
    expect(() => recorder.idleListen('')).toThrow(TypeError);
  });

  test('idleListen() rejects a second concurrent call', () => {
    recorder.idleListen('./recordings');
    expect(() => recorder.idleListen('./recordings2')).toThrow('Recording already in progress');
  });

  test('listen() attaches handler to the stream data event and writes no file', () => {
    const handler = jest.fn();
    expect(() => recorder.listen(handler)).not.toThrow();
    expect(recorderLib.record).toHaveBeenCalledWith(
      expect.objectContaining({ ...recorder.options, audioType: 'raw' }),
    );
    expect(fs.createWriteStream).not.toHaveBeenCalled();
    const dataReg = recorderLib.__lastRecording.__stream.on.mock.calls.find(
      ([event]) => event === 'data',
    );
    expect(dataReg).toBeDefined();
    expect(dataReg[1]).toBe(handler);
    expect(recorder.listening).toBe(true);
  });

  test('listen() requires a function handler', () => {
    expect(() => recorder.listen()).toThrow(TypeError);
    expect(() => recorder.listen('nope')).toThrow(TypeError);
  });

  test('listen() rejects when start() is already active', () => {
    recorder.start('out.wav');
    expect(() => recorder.listen(() => {})).toThrow('Recording already in progress');
  });

  test('start() and idleListen() reject when listening', () => {
    recorder.listen(() => {});
    expect(() => recorder.start('out.wav')).toThrow('Recording already in progress');
    expect(() => recorder.idleListen('./recordings')).toThrow('Recording already in progress');
  });

  test('stop() halts a listen session and clears the listening flag', () => {
    recorder.listen(() => {});
    const lastRecording = recorderLib.__lastRecording;
    expect(() => recorder.stop()).not.toThrow();
    expect(lastRecording.stop).toHaveBeenCalled();
    expect(recorder.listening).toBe(false);
    expect(recorder.recording).toBeNull();
  });

  test('stop() during idle gap prevents the next chunk from starting', () => {
    jest.useFakeTimers();
    try {
      recorder.idleListen('./recordings');
      const stream = recorderLib.__lastRecording.__stream;
      const endHandler = stream.on.mock.calls.find(([event]) => event === 'end');
      expect(endHandler).toBeDefined();

      recorder.stop();

      recorderLib.record.mockClear();
      fs.createWriteStream.mockClear();
      endHandler[1]();
      jest.advanceTimersByTime(500);

      expect(recorderLib.record).not.toHaveBeenCalled();
      expect(fs.createWriteStream).not.toHaveBeenCalled();
      expect(recorder.idle).toBe(false);
      expect(recorder.recording).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('defaultChunkFilename', () => {
  const { defaultChunkFilename } = require('../src/audioRecorder');

  test('produces a sortable chunk-YYYYMMDD-HHMMSS-mmm.wav name', () => {
    const fixed = new Date(2026, 4, 12, 7, 47, 53, 123); // local-time month is 0-based
    expect(defaultChunkFilename(fixed)).toBe('chunk-20260512-074753-123.wav');
  });

  test('respects a suffix for collision disambiguation', () => {
    const fixed = new Date(2026, 4, 12, 7, 47, 53, 123);
    expect(defaultChunkFilename(fixed, '-2')).toBe('chunk-20260512-074753-123-2.wav');
  });
});

describe('AudioRecorder transcribe wiring', () => {
  test('default: transcribe is false and transcribeQueue is null', () => {
    const r = new AudioRecorder();
    expect(r.transcribe).toBe(false);
    expect(r.transcribeQueue).toBeNull();
  });

  test('transcribe: false (explicit) also leaves queue null', () => {
    const r = new AudioRecorder({ transcribe: false });
    expect(r.transcribe).toBe(false);
    expect(r.transcribeQueue).toBeNull();
  });

  test('transcribe: true builds a queue with the default model path', () => {
    const r = new AudioRecorder({ transcribe: true, transcribeFn: jest.fn() });
    expect(r.transcribe).toBe(true);
    expect(r.transcribeQueue).not.toBeNull();
    expect(r.transcribeQueue.length).toBe(0);
    expect(r.transcribeModel).toBe(require('../src/transcribe').DEFAULT_MODEL_PATH);
  });

  test('transcribe: true with explicit transcribeModel uses it', () => {
    const r = new AudioRecorder({
      transcribe: true,
      transcribeFn: jest.fn(),
      transcribeModel: 'models/medium.en.bin',
    });
    expect(r.transcribeModel).toBe('models/medium.en.bin');
  });

  test('drainTranscriptions() returns a resolved promise when transcription is off', async () => {
    const r = new AudioRecorder();
    const start = Date.now();
    await r.drainTranscriptions();
    // resolved promise should settle in well under one task tick
    expect(Date.now() - start).toBeLessThan(20);
  });

  test('drainTranscriptions() waits for enqueued jobs to settle', async () => {
    const os = require('os');
    const path = require('path');
    const realFs = jest.requireActual('fs');
    const tmpdir = realFs.mkdtempSync(path.join(os.tmpdir(), 'lr-recorder-drain-'));
    const wav = path.join(tmpdir, 'job.wav');

    const transcribeFn = jest.fn(async ({ wav: w }) => ({
      text: 'hi',
      model: 'm.bin',
      wav: w,
      binary: 'whisper-cli',
      durationMs: 0,
      // Pretend whisper.cpp wrote the canonical filename so the normalisation
      // step in defaultTranscribeRun does nothing (no real fs writes needed).
      txtPath: path.join(tmpdir, 'job.txt'),
      exitCode: 0,
    }));
    const r = new AudioRecorder({
      transcribe: true,
      transcribeFn,
      transcribeLogger: { onSuccess: () => {}, onFailure: () => {} },
    });
    r.transcribeQueue.enqueue({ wav, model: 'm.bin' });
    expect(r.transcribeQueue.length).toBe(1);
    await r.drainTranscriptions();
    expect(r.transcribeQueue.length).toBe(0);
    expect(transcribeFn).toHaveBeenCalledTimes(1);
    realFs.rmSync(tmpdir, { recursive: true, force: true });
  });
});

describe('writeChunkMarkdownSibling / runWithMarkdown', () => {
  const { writeChunkMarkdownSibling, runWithMarkdown } = require('../src/audioRecorder');
  const os = require('os');
  const path = require('path');
  const realFs = jest.requireActual('fs');

  let tmpdir;

  beforeEach(() => {
    tmpdir = realFs.mkdtempSync(path.join(os.tmpdir(), 'lr-md-sibling-'));
  });
  afterEach(() => {
    realFs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function makeSidecarOnDisk(stem) {
    const sidecar = {
      version: 1,
      wav: `${stem}.wav`,
      start: '2026-05-12T21:23:01.490Z',
      end: '2026-05-12T21:23:13.523Z',
      durationMs: 11519,
      audio: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      peak: 0.5,
      peakDb: -6,
      bytes: 368640,
    };
    const jsonPath = path.join(tmpdir, `${stem}.json`);
    realFs.writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2) + '\n');
    return { sidecar, jsonPath };
  }

  test('writeChunkMarkdownSibling produces a real .md when transcription succeeds', () => {
    const stem = 'chunk-20260512-162301-489';
    const wav = path.join(tmpdir, `${stem}.wav`);
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    makeSidecarOnDisk(stem);

    const mdPath = writeChunkMarkdownSibling({
      wav,
      transcript: 'Hello world.',
      transcribeStatus: 'ok',
      fsImpl: realFs,
    });
    expect(mdPath).toBe(path.join(tmpdir, `${stem}.md`));
    expect(realFs.existsSync(mdPath)).toBe(true);
    const md = realFs.readFileSync(mdPath, 'utf8');
    expect(md).toMatch(/^# Chunk 2026-05-12 16:23:01\.489/);
    expect(md).toContain('Hello world.');
    expect(md).toContain('[' + `${stem}.txt` + '](' + `${stem}.txt` + ')');
  });

  test('writeChunkMarkdownSibling produces a failure-stub .md when transcription failed', () => {
    const stem = 'chunk-20260512-162301-489';
    const wav = path.join(tmpdir, `${stem}.wav`);
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    makeSidecarOnDisk(stem);

    const mdPath = writeChunkMarkdownSibling({
      wav,
      transcript: null,
      transcribeStatus: 'failed',
      transcribeError: 'whisper-cli exited with code 1',
      fsImpl: realFs,
    });
    const md = realFs.readFileSync(mdPath, 'utf8');
    expect(md).toContain('_Transcription unavailable: whisper-cli exited with code 1_');
    expect(md).not.toContain('[' + `${stem}.txt`);
  });

  test('writeChunkMarkdownSibling falls back to a minimal sidecar stub when the .json is missing', () => {
    const stem = 'chunk-X';
    const wav = path.join(tmpdir, `${stem}.wav`);
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    // No sidecar JSON on disk.
    const mdPath = writeChunkMarkdownSibling({
      wav,
      transcribeStatus: 'pending',
      fsImpl: realFs,
    });
    const md = realFs.readFileSync(mdPath, 'utf8');
    expect(md).toContain('# Chunk chunk-X');
    expect(md).toContain('_Transcription not attempted._');
  });

  test('runWithMarkdown writes .md on the success path and returns mdPath on the result', async () => {
    const stem = 'chunk-20260512-162301-489';
    const wav = path.join(tmpdir, `${stem}.wav`);
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    makeSidecarOnDisk(stem);

    const transcribeFn = jest.fn(async () => ({
      text: 'Real transcript.',
      model: 'm.bin',
      wav,
      binary: 'whisper-cli',
      durationMs: 1,
      // Pretend whisper already wrote the canonical .txt (no normalisation work needed).
      txtPath: path.join(tmpdir, `${stem}.txt`),
      exitCode: 0,
    }));

    const result = await runWithMarkdown({ wav, model: 'm.bin' }, { transcribeFn, fsImpl: realFs });
    expect(result.mdPath).toBe(path.join(tmpdir, `${stem}.md`));
    expect(realFs.existsSync(result.mdPath)).toBe(true);
    expect(realFs.readFileSync(result.mdPath, 'utf8')).toContain('Real transcript.');
  });

  test('runWithMarkdown writes a failure-stub .md AND re-throws the underlying error', async () => {
    const stem = 'chunk-20260512-162301-489';
    const wav = path.join(tmpdir, `${stem}.wav`);
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    makeSidecarOnDisk(stem);

    const transcribeFn = jest.fn(async () => {
      const e = new Error('simulated whisper failure');
      throw e;
    });

    await expect(
      runWithMarkdown({ wav, model: 'm.bin' }, { transcribeFn, fsImpl: realFs }),
    ).rejects.toMatchObject({ message: 'simulated whisper failure' });

    const mdPath = path.join(tmpdir, `${stem}.md`);
    expect(realFs.existsSync(mdPath)).toBe(true);
    expect(realFs.readFileSync(mdPath, 'utf8'))
      .toContain('_Transcription unavailable: simulated whisper failure_');
  });

  test('runWithMarkdown does not let a .md write failure mask a successful transcription', async () => {
    const stem = 'chunk-X';
    const wav = path.join(tmpdir, `${stem}.wav`);
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    makeSidecarOnDisk(stem);

    const transcribeFn = jest.fn(async () => ({
      text: 'ok',
      model: 'm.bin',
      wav,
      binary: 'whisper-cli',
      durationMs: 0,
      txtPath: path.join(tmpdir, `${stem}.txt`),
      exitCode: 0,
    }));

    // Wrap realFs with a writeFileSync that throws for .md paths only.
    const fsWithBadMdWrite = {
      ...realFs,
      writeFileSync: (target, contents) => {
        if (typeof target === 'string' && target.endsWith('.md')) {
          throw new Error('disk full');
        }
        return realFs.writeFileSync(target, contents);
      },
    };

    const result = await runWithMarkdown(
      { wav, model: 'm.bin' },
      { transcribeFn, fsImpl: fsWithBadMdWrite },
    );
    // mdPath ended up null because the write threw -- but the transcription
    // result still flows through cleanly.
    expect(result.mdPath).toBeNull();
    expect(result.text).toBe('ok');
  });
});

describe('defaultTranscribeRun (filename normalisation)', () => {
  const { defaultTranscribeRun } = require('../src/audioRecorder');
  const os = require('os');
  const path = require('path');
  const realFs = jest.requireActual('fs');

  let tmpdir;

  beforeEach(() => {
    tmpdir = realFs.mkdtempSync(path.join(os.tmpdir(), 'lr-default-tx-'));
  });
  afterEach(() => {
    realFs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('rewrites a legacy <wav>.txt sibling to the canonical <basename>.txt', async () => {
    const wav = path.join(tmpdir, 'chunk-A.wav');
    const legacyTxt = `${wav}.txt`;
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    realFs.writeFileSync(legacyTxt, 'hello world from whisper\n');
    const transcribeFn = jest.fn(async () => ({
      text: 'hello world from whisper',
      model: 'm.bin',
      wav,
      binary: 'whisper-cli',
      durationMs: 1,
      txtPath: legacyTxt,
      exitCode: 0,
    }));

    const result = await defaultTranscribeRun(
      { wav, model: 'm.bin' },
      { transcribeFn, fsImpl: realFs },
    );

    const canonical = path.join(tmpdir, 'chunk-A.txt');
    expect(result.txtPath).toBe(canonical);
    expect(realFs.existsSync(canonical)).toBe(true);
    expect(realFs.readFileSync(canonical, 'utf8').trim()).toBe('hello world from whisper');
    // Legacy file removed.
    expect(realFs.existsSync(legacyTxt)).toBe(false);
  });

  test('leaves the canonical txt path alone when transcribeFile already wrote it there', async () => {
    const wav = path.join(tmpdir, 'chunk-B.wav');
    const canonical = path.join(tmpdir, 'chunk-B.txt');
    realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
    realFs.writeFileSync(canonical, 'already canonical text\n');
    const transcribeFn = jest.fn(async () => ({
      text: 'already canonical text',
      model: 'm.bin',
      wav,
      binary: 'whisper-cli',
      durationMs: 1,
      txtPath: canonical,
      exitCode: 0,
    }));

    const result = await defaultTranscribeRun(
      { wav, model: 'm.bin' },
      { transcribeFn, fsImpl: realFs },
    );
    expect(result.txtPath).toBe(canonical);
    expect(realFs.existsSync(canonical)).toBe(true);
    expect(realFs.readFileSync(canonical, 'utf8').trim()).toBe('already canonical text');
  });
});

describe('T-5 resilience: retry classification + runWithMarkdown integration', () => {
  const {
    isRetryableTranscribeError,
    transcribeWithRetry,
    runWithMarkdown,
  } = require('../src/audioRecorder');
  const os = require('os');
  const path = require('path');
  const realFs = jest.requireActual('fs');

  describe('isRetryableTranscribeError', () => {
    test('non-zero whisper-cli exit (err.exitCode set) -> retryable', () => {
      const e = new Error('exited with code 1');
      e.exitCode = 1;
      expect(isRetryableTranscribeError(e)).toBe(true);
    });

    test('validation errors (no exitCode) -> not retryable', () => {
      expect(isRetryableTranscribeError(new Error('WAV file not found'))).toBe(false);
      expect(isRetryableTranscribeError(new Error('Model file not found'))).toBe(false);
      expect(isRetryableTranscribeError(new Error('whisper binary not found'))).toBe(false);
    });

    test('null / undefined -> not retryable', () => {
      expect(isRetryableTranscribeError(null)).toBe(false);
      expect(isRetryableTranscribeError(undefined)).toBe(false);
    });
  });

  describe('transcribeWithRetry', () => {
    let tmpdir;
    beforeEach(() => {
      tmpdir = realFs.mkdtempSync(path.join(os.tmpdir(), 'lr-retry-'));
    });
    afterEach(() => {
      realFs.rmSync(tmpdir, { recursive: true, force: true });
    });

    test('succeeds on first attempt -> calls transcribeFn once', async () => {
      const wav = path.join(tmpdir, 'a.wav');
      realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
      const transcribeFn = jest.fn(async () => ({
        text: 'ok', model: 'm', wav, binary: 'whisper-cli', durationMs: 0,
        txtPath: path.join(tmpdir, 'a.txt'), exitCode: 0,
      }));
      const result = await transcribeWithRetry({ wav, model: 'm' }, {
        transcribeFn, fsImpl: realFs, maxRetries: 1, logger: { warn: jest.fn() },
      });
      expect(transcribeFn).toHaveBeenCalledTimes(1);
      expect(result.text).toBe('ok');
    });

    test('retries once on non-zero exit, succeeds on the second attempt', async () => {
      const wav = path.join(tmpdir, 'b.wav');
      realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
      const transcribeFn = jest.fn()
        .mockImplementationOnce(async () => {
          const e = new Error('exited with code 1');
          e.exitCode = 1;
          throw e;
        })
        .mockImplementationOnce(async () => ({
          text: 'ok-second', model: 'm', wav, binary: 'whisper-cli', durationMs: 0,
          txtPath: path.join(tmpdir, 'b.txt'), exitCode: 0,
        }));
      const warn = jest.fn();
      const result = await transcribeWithRetry({ wav, model: 'm' }, {
        transcribeFn, fsImpl: realFs, maxRetries: 1, logger: { warn },
      });
      expect(transcribeFn).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('ok-second');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/\[transcribe retry\]/);
      expect(warn.mock.calls[0][0]).toMatch(/attempt 2\/2/);
    });

    test('gives up after exhausting retries and throws the last error', async () => {
      const wav = path.join(tmpdir, 'c.wav');
      realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
      const failing = async () => {
        const e = new Error('exited with code 2');
        e.exitCode = 2;
        throw e;
      };
      const transcribeFn = jest.fn().mockImplementation(failing);
      await expect(
        transcribeWithRetry({ wav, model: 'm' }, {
          transcribeFn, fsImpl: realFs, maxRetries: 1, logger: { warn: () => {} },
        }),
      ).rejects.toMatchObject({ exitCode: 2 });
      expect(transcribeFn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    test('does NOT retry deterministic errors (missing model, missing binary, etc.)', async () => {
      const wav = path.join(tmpdir, 'd.wav');
      realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
      const transcribeFn = jest.fn().mockImplementation(async () => {
        throw new Error('transcribe: model file not found: m');
      });
      await expect(
        transcribeWithRetry({ wav, model: 'm' }, {
          transcribeFn, fsImpl: realFs, maxRetries: 5, logger: { warn: () => {} },
        }),
      ).rejects.toThrow(/model file not found/);
      expect(transcribeFn).toHaveBeenCalledTimes(1); // no retries
    });

    test('maxRetries=0 disables the retry entirely', async () => {
      const wav = path.join(tmpdir, 'e.wav');
      realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
      const transcribeFn = jest.fn().mockImplementation(async () => {
        const e = new Error('exited with code 1');
        e.exitCode = 1;
        throw e;
      });
      await expect(
        transcribeWithRetry({ wav, model: 'm' }, {
          transcribeFn, fsImpl: realFs, maxRetries: 0, logger: { warn: () => {} },
        }),
      ).rejects.toMatchObject({ exitCode: 1 });
      expect(transcribeFn).toHaveBeenCalledTimes(1); // no retry
    });
  });

  describe('runWithMarkdown honors maxRetries', () => {
    let tmpdir;
    beforeEach(() => {
      tmpdir = realFs.mkdtempSync(path.join(os.tmpdir(), 'lr-rwm-retry-'));
    });
    afterEach(() => {
      realFs.rmSync(tmpdir, { recursive: true, force: true });
    });

    test('runs the retry and reports success on the second attempt', async () => {
      const stem = 'chunk-20260512-162301-489';
      const wav = path.join(tmpdir, `${stem}.wav`);
      realFs.writeFileSync(wav, Buffer.from('RIFF\0\0\0\0WAVE', 'binary'));
      const sidecar = {
        version: 1, wav: `${stem}.wav`, durationMs: 1000,
        peak: 0.5, peakDb: -6, bytes: 16000,
        start: '2026-05-12T21:23:01Z', end: '2026-05-12T21:23:02Z',
        audio: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' },
      };
      realFs.writeFileSync(path.join(tmpdir, `${stem}.json`), JSON.stringify(sidecar));

      const transcribeFn = jest.fn()
        .mockImplementationOnce(async () => {
          const e = new Error('exited with code 1');
          e.exitCode = 1;
          throw e;
        })
        .mockImplementationOnce(async () => ({
          text: 'recovered', model: 'm', wav, binary: 'whisper-cli', durationMs: 5,
          txtPath: path.join(tmpdir, `${stem}.txt`), exitCode: 0,
        }));
      const warn = jest.fn();
      const result = await runWithMarkdown(
        { wav, model: 'm' },
        { transcribeFn, fsImpl: realFs, maxRetries: 1, logger: { warn } },
      );
      expect(result.text).toBe('recovered');
      expect(transcribeFn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      // Success .md was written.
      const md = realFs.readFileSync(path.join(tmpdir, `${stem}.md`), 'utf8');
      expect(md).toContain('recovered');
    });
  });
});

describe('T-5 resilience: AudioRecorder peak gating + queue overflow', () => {
  test('default constructor sets transcribeMinPeak=0.005, transcribeQueueMax=5, transcribeRetries=1', () => {
    const r = new AudioRecorder({ transcribe: true, transcribeFn: jest.fn() });
    expect(r.transcribeMinPeak).toBe(0.005);
    expect(r.transcribeQueueMax).toBe(5);
    expect(r.transcribeRetries).toBe(1);
  });

  test('explicit constructor overrides are honored', () => {
    const r = new AudioRecorder({
      transcribe: true,
      transcribeFn: jest.fn(),
      transcribeMinPeak: 0.02,
      transcribeQueueMax: 10,
      transcribeRetries: 2,
    });
    expect(r.transcribeMinPeak).toBe(0.02);
    expect(r.transcribeQueueMax).toBe(10);
    expect(r.transcribeRetries).toBe(2);
  });

  test('transcribeMinPeak=0 disables the gate (constructor accepts the zero)', () => {
    const r = new AudioRecorder({
      transcribe: true,
      transcribeFn: jest.fn(),
      transcribeMinPeak: 0,
    });
    expect(r.transcribeMinPeak).toBe(0);
  });

  test('negative / non-finite transcribeMinPeak falls back to default', () => {
    const r1 = new AudioRecorder({ transcribe: true, transcribeFn: jest.fn(), transcribeMinPeak: -1 });
    expect(r1.transcribeMinPeak).toBe(0.005);
    const r2 = new AudioRecorder({ transcribe: true, transcribeFn: jest.fn(), transcribeMinPeak: NaN });
    expect(r2.transcribeMinPeak).toBe(0.005);
  });
});

describe('WHISPER_AUDIO_FORMAT contract', () => {
  const { WHISPER_AUDIO_FORMAT } = require('../src/audioRecorder');

  test('is the Whisper-aligned 16k mono 16-bit signed PCM contract', () => {
    expect(WHISPER_AUDIO_FORMAT).toEqual({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      encoding: 'signed-integer',
    });
  });

  test('is frozen so callers cannot mutate the shared default', () => {
    expect(Object.isFrozen(WHISPER_AUDIO_FORMAT)).toBe(true);
  });

  test('AudioRecorder defaults match WHISPER_AUDIO_FORMAT', () => {
    const fresh = new AudioRecorder();
    for (const key of Object.keys(WHISPER_AUDIO_FORMAT)) {
      expect(fresh.options[key]).toBe(WHISPER_AUDIO_FORMAT[key]);
    }
  });

  test('user overrides win over the format defaults', () => {
    const custom = new AudioRecorder({ sampleRate: 44100, bitDepth: 24 });
    expect(custom.options.sampleRate).toBe(44100);
    expect(custom.options.bitDepth).toBe(24);
    expect(custom.options.channels).toBe(1); // untouched
    expect(custom.options.encoding).toBe('signed-integer'); // untouched
  });

  test('start() passes the Whisper format fields to the recorder', () => {
    const fresh = new AudioRecorder();
    fresh.start('test.wav');
    const lastCall = recorderLib.record.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      encoding: 'signed-integer',
      audioType: 'wav',
    });
  });
});
