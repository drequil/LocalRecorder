const { windowsSoxRecorder } = require('../src/recorderPatch');

describe('windowsSoxRecorder', () => {
  test('builds default args with explicit waveaudio device 0 (not --default-device)', () => {
    const { cmd, args } = windowsSoxRecorder({
      sampleRate: 16000,
      channels: 1,
      audioType: 'wav',
    });
    expect(cmd).toBe('sox');
    expect(args).not.toContain('--default-device');
    expect(args).toContain('-t');
    expect(args).toContain('waveaudio');
    expect(args).toContain('0');
    expect(args).toContain('--rate');
    expect(args).toContain('16000');
    expect(args).toContain('--channels');
    expect(args).toContain('1');
    expect(args).toContain('--encoding');
    expect(args).toContain('signed-integer');
    expect(args).toContain('--bits');
    expect(args).toContain('16');
    expect(args).toContain('--type');
    expect(args).toContain('wav');
    expect(args[args.length - 1]).toBe('-');
  });

  test('honours options.device override and audioType', () => {
    const { args } = windowsSoxRecorder({
      sampleRate: 16000,
      channels: 1,
      audioType: 'raw',
      device: 5,
    });
    expect(args).toContain('5');
    expect(args).toContain('raw');
  });

  test('appends silence detection args when endOnSilence is set', () => {
    const { args } = windowsSoxRecorder({
      sampleRate: 16000,
      channels: 1,
      audioType: 'wav',
      endOnSilence: true,
      threshold: 0.5,
      silence: '1.0',
    });
    const silenceIdx = args.indexOf('silence');
    expect(silenceIdx).toBeGreaterThan(-1);
    expect(args.slice(silenceIdx)).toEqual([
      'silence', '1', '0.1', '0.5%', '1', '1.0', '0.5%',
    ]);
  });

  test('uses thresholdStart/thresholdEnd when provided', () => {
    const { args } = windowsSoxRecorder({
      sampleRate: 16000,
      channels: 1,
      audioType: 'wav',
      endOnSilence: true,
      threshold: 0.5,
      thresholdStart: 0.2,
      thresholdEnd: 0.8,
      silence: '1.0',
    });
    const silenceIdx = args.indexOf('silence');
    expect(args.slice(silenceIdx)).toEqual([
      'silence', '1', '0.1', '0.2%', '1', '1.0', '0.8%',
    ]);
  });
});
