const AudioRecorder = require('../src/audioRecorder');

describe('AudioRecorder', () => {
  let recorder;

  beforeEach(() => {
    recorder = new AudioRecorder();
  });

  test('should create instance', () => {
    expect(recorder).toBeInstanceOf(AudioRecorder);
  });

  test('should start recording', () => {
    // Mock fs and recorder for testing
    // Since actual recording requires hardware, test structure
    expect(() => recorder.start('test.wav')).not.toThrow();
    // Note: Actual start would require mocking
  });

  test('should stop recording', () => {
    recorder.start('test.wav');
    expect(() => recorder.stop()).not.toThrow();
  });

  test('should throw on double start', () => {
    recorder.start('test.wav');
    expect(() => recorder.start('test2.wav')).toThrow('Recording already in progress');
  });

  test('should throw on stop without start', () => {
    expect(() => recorder.stop()).toThrow('No recording in progress');
  });

  // Idle listening test - hard to test without audio input
  test('should start idle listening', () => {
    expect(() => recorder.idleListen('idle.wav')).not.toThrow();
    // Stop after short time for test
    setTimeout(() => recorder.stop(), 100);
  });
});