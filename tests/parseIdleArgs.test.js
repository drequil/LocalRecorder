const { parseIdleArgs, parseListenArgs } = require('../src/index');

function expectIdleShape(overrides = {}) {
  return {
    directory: null,
    idleThreshold: null,
    idleSilenceSeconds: null,
    device: null,
    maxChunkSeconds: null,
    durationSeconds: null,
    name: null,
    root: null,
    transcribe: false,
    transcribeModel: null,
    transcribeLanguage: null,
    multilingual: false,
    transcribeModelPreset: null,
    transcribeMinPeak: null,
    transcribeQueueMax: null,
    trace: false,
    ...overrides,
  };
}

describe('parseIdleArgs', () => {
  test('with no args, returns all-null defaults (positional now optional)', () => {
    expect(parseIdleArgs([])).toEqual(expectIdleShape());
  });

  test('returns directory with null knobs by default', () => {
    expect(parseIdleArgs(['./recordings'])).toEqual(expectIdleShape({ directory: './recordings' }));
  });

  test('parses --threshold as a percent (0..100)', () => {
    expect(parseIdleArgs(['./r', '--threshold', '0.05']).idleThreshold).toBe(0.05);
    expect(parseIdleArgs(['./r', '--threshold=2.5']).idleThreshold).toBe(2.5);
  });

  test('rejects --threshold outside the 0..100 range', () => {
    expect(parseIdleArgs(['./r', '--threshold', '-1']).error).toMatch(/0\.\.100/);
    expect(parseIdleArgs(['./r', '--threshold', '101']).error).toMatch(/0\.\.100/);
    expect(parseIdleArgs(['./r', '--threshold', 'abc']).error).toMatch(/0\.\.100/);
  });

  test('parses --silence as a non-negative number (0 disables sox silence detection)', () => {
    expect(parseIdleArgs(['./r', '--silence', '2.5']).idleSilenceSeconds).toBe(2.5);
    // 0 is the explicit "disable silence detector" signal -- chunks rotate
    // only on --max-chunk-seconds.
    expect(parseIdleArgs(['./r', '--silence', '0']).idleSilenceSeconds).toBe(0);
    expect(parseIdleArgs(['./r', '--silence', '-1']).error).toMatch(/non-negative/);
    expect(parseIdleArgs(['./r', '--silence', 'abc']).error).toMatch(/non-negative/);
  });

  test('parses --device as a string', () => {
    expect(parseIdleArgs(['./r', '--device', '5']).device).toBe('5');
    expect(parseIdleArgs(['./r', '--device', 'USB Mic']).device).toBe('USB Mic');
  });

  test('parses --duration-minutes for idle session cap', () => {
    expect(parseIdleArgs(['./r', '--duration-minutes', '10']).durationSeconds).toBe(600);
  });

  test('rejects --duration with --duration-minutes on idle', () => {
    expect(parseIdleArgs(['./r', '--duration', '10', '--duration-minutes', '1']).error).toMatch(
      /cannot use --duration together with --duration-minutes/,
    );
  });

  test('parses --max-chunk-seconds as a positive number', () => {
    expect(parseIdleArgs(['./r', '--max-chunk-seconds', '60']).maxChunkSeconds).toBe(60);
    expect(parseIdleArgs(['./r', '--max-chunk-seconds', '-1']).error).toMatch(/positive number/);
  });

  test('parses --duration as a positive number (MS-10: idle now supports duration)', () => {
    expect(parseIdleArgs(['./r', '--duration', '3600']).durationSeconds).toBe(3600);
    expect(parseIdleArgs(['./r', '--duration', '0']).error).toMatch(/positive number/);
  });

  test('parses --name and --root for structured layout', () => {
    const r = parseIdleArgs(['--name', 'hourly', '--root', 'D:/recs', '--duration', '3600']);
    expect(r.name).toBe('hourly');
    expect(r.root).toBe('D:/recs');
    expect(r.durationSeconds).toBe(3600);
    expect(r.directory).toBeNull();
  });

  test('flags can come before or after the positional argument', () => {
    expect(parseIdleArgs(['--threshold', '0.01', './r']).idleThreshold).toBe(0.01);
    expect(parseIdleArgs(['./r', '--threshold', '0.01']).idleThreshold).toBe(0.01);
  });

  test('rejects unknown flags', () => {
    expect(parseIdleArgs(['./r', '--bogus']).error).toMatch(/unknown flag/);
  });

  test('rejects extra positional arguments', () => {
    expect(parseIdleArgs(['./r', './r2']).error).toMatch(/extra argument/);
  });

  test('parses --transcribe as a boolean presence flag', () => {
    expect(parseIdleArgs(['./r', '--transcribe']).transcribe).toBe(true);
    expect(parseIdleArgs(['./r']).transcribe).toBe(false);
  });

  test('rejects --transcribe=value (presence flag does not take a value)', () => {
    expect(parseIdleArgs(['./r', '--transcribe=yes']).error)
      .toMatch(/--transcribe does not take a value/);
  });

  test('parses --model for the transcription path', () => {
    expect(parseIdleArgs(['./r', '--transcribe', '--model', 'models/small.en.bin']).transcribeModel)
      .toBe('models/small.en.bin');
  });

  test('--model is parsed even without --transcribe (no auto-coupling)', () => {
    // The CLI dispatcher checks --transcribe to decide whether to use the
    // model path. Parser-side, we just record what the user wrote.
    const r = parseIdleArgs(['./r', '--model', 'models/medium.en.bin']);
    expect(r.transcribe).toBe(false);
    expect(r.transcribeModel).toBe('models/medium.en.bin');
  });

  test('parses --transcribe-min-peak as a percent (0..100 also accepted)', () => {
    expect(parseIdleArgs(['./r', '--transcribe-min-peak', '0.01']).transcribeMinPeak).toBe(0.01);
    expect(parseIdleArgs(['./r', '--transcribe-min-peak', '5']).transcribeMinPeak).toBe(5); // 5% form
    expect(parseIdleArgs(['./r', '--transcribe-min-peak', '0']).transcribeMinPeak).toBe(0);
  });

  test('rejects --transcribe-min-peak outside the 0..100 range', () => {
    expect(parseIdleArgs(['./r', '--transcribe-min-peak', '-1']).error).toMatch(/0\.\.100/);
    expect(parseIdleArgs(['./r', '--transcribe-min-peak', '101']).error).toMatch(/0\.\.100/);
    expect(parseIdleArgs(['./r', '--transcribe-min-peak', 'abc']).error).toMatch(/0\.\.100/);
  });

  test('parses --transcribe-queue-max as a positive number', () => {
    expect(parseIdleArgs(['./r', '--transcribe-queue-max', '10']).transcribeQueueMax).toBe(10);
    expect(parseIdleArgs(['./r', '--transcribe-queue-max', '0']).error).toMatch(/positive number/);
    expect(parseIdleArgs(['./r', '--transcribe-queue-max', '-3']).error).toMatch(/positive number/);
  });

  test('parses --trace', () => {
    expect(parseIdleArgs(['./r', '--trace']).trace).toBe(true);
  });
});

describe('parseListenArgs', () => {
  test('accepts no args at all', () => {
    expect(parseListenArgs([])).toEqual({ device: null });
  });

  test('parses --device', () => {
    expect(parseListenArgs(['--device', '2'])).toEqual({ device: '2' });
  });

  test('rejects unknown flags and stray positionals', () => {
    expect(parseListenArgs(['--bogus']).error).toMatch(/unknown flag/);
    expect(parseListenArgs(['unexpected']).error).toMatch(/extra argument/);
  });
});
