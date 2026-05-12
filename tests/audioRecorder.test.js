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
      threshold: 0.5,
      silence: '1.0',
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
