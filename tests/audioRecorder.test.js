jest.mock('node-record-lpcm16', () => {
  const factory = {
    record: jest.fn(() => {
      const recording = {
        stream: jest.fn(() => ({ pipe: jest.fn() })),
        stop: jest.fn(),
        on: jest.fn(),
      };
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

  test('start() opens write stream and begins recording', () => {
    expect(() => recorder.start('test.wav')).not.toThrow();
    expect(fs.createWriteStream).toHaveBeenCalledWith('test.wav');
    expect(recorderLib.record).toHaveBeenCalledWith(recorder.options);
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

  test('idleListen() opens an appending stream and starts a chunk', () => {
    expect(() => recorder.idleListen('idle.wav')).not.toThrow();
    expect(fs.createWriteStream).toHaveBeenCalledWith('idle.wav', { flags: 'a' });
    expect(recorderLib.record).toHaveBeenCalled();
    const lastCall = recorderLib.record.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({ threshold: 0.5, silence: '1.0' });
  });

  test('idleListen() rejects a second concurrent call', () => {
    recorder.idleListen('idle.wav');
    expect(() => recorder.idleListen('idle2.wav')).toThrow('Recording already in progress');
  });

  test('stop() during idle gap prevents the next chunk from starting', () => {
    jest.useFakeTimers();
    try {
      recorder.idleListen('idle.wav');
      const onCalls = recorderLib.__lastRecording.on.mock.calls;
      const endHandler = onCalls.find(([event]) => event === 'end');
      expect(endHandler).toBeDefined();

      recorder.stop();

      recorderLib.record.mockClear();
      endHandler[1]();
      jest.advanceTimersByTime(500);

      expect(recorderLib.record).not.toHaveBeenCalled();
      expect(recorder.idle).toBe(false);
      expect(recorder.recording).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
