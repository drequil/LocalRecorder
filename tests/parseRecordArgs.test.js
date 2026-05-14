const { parseRecordArgs } = require('../src/index');

function expectShape(overrides = {}) {
  return {
    output: null,
    durationSeconds: null,
    device: null,
    name: null,
    root: null,
    transcribe: false,
    noTranscribe: false,
    transcribeModel: null,
    transcribeLanguage: null,
    multilingual: false,
    transcribeModelPreset: null,
    transcribeMinPeak: null,
    transcribeQueueMax: null,
    transcribeThreads: null,
    trace: false,
    ...overrides,
  };
}

describe('parseRecordArgs', () => {
  test('with no args, returns all-null defaults (positional now optional)', () => {
    expect(parseRecordArgs([])).toEqual(expectShape());
  });

  test('returns output with null knobs when only a path is provided', () => {
    expect(parseRecordArgs(['out.wav'])).toEqual(expectShape({ output: 'out.wav' }));
  });

  test('parses --duration N before the output path', () => {
    expect(parseRecordArgs(['--duration', '5', 'out.wav']))
      .toEqual(expectShape({ output: 'out.wav', durationSeconds: 5 }));
  });

  test('parses --duration N after the output path', () => {
    expect(parseRecordArgs(['out.wav', '--duration', '5']))
      .toEqual(expectShape({ output: 'out.wav', durationSeconds: 5 }));
  });

  test('parses --duration=N form', () => {
    expect(parseRecordArgs(['out.wav', '--duration=2.5']))
      .toEqual(expectShape({ output: 'out.wav', durationSeconds: 2.5 }));
  });

  test('parses --device alongside --duration', () => {
    expect(parseRecordArgs(['out.wav', '--device', '3', '--duration', '5']))
      .toEqual(expectShape({ output: 'out.wav', durationSeconds: 5, device: '3' }));
  });

  test('parses --name and --root for structured layout', () => {
    expect(parseRecordArgs(['--name', 'meeting', '--root', 'D:/recs', '--duration', '60']))
      .toEqual(expectShape({ name: 'meeting', root: 'D:/recs', durationSeconds: 60 }));
  });

  test('errors when --duration is followed by no value', () => {
    const r = parseRecordArgs(['out.wav', '--duration']);
    expect(r.error).toMatch(/requires a value/);
  });

  test('errors when --duration value is not a positive number', () => {
    expect(parseRecordArgs(['out.wav', '--duration', '0']).error).toMatch(/positive number/);
    expect(parseRecordArgs(['out.wav', '--duration', '-3']).error).toMatch(/positive number/);
    expect(parseRecordArgs(['out.wav', '--duration', 'abc']).error).toMatch(/positive number/);
    expect(parseRecordArgs(['out.wav', '--duration=NaN']).error).toMatch(/positive number/);
  });

  test('errors on unknown flags', () => {
    expect(parseRecordArgs(['out.wav', '--bogus']).error).toMatch(/unknown flag/);
  });

  test('parses --transcribe and --model on record', () => {
    expect(parseRecordArgs(['--transcribe', '--model', 'm.bin', '--duration', '5']))
      .toEqual(expectShape({ transcribe: true, transcribeModel: 'm.bin', durationSeconds: 5 }));
  });

  test('parses --trace', () => {
    expect(parseRecordArgs(['--trace', '--duration', '1'])).toEqual(expectShape({ trace: true, durationSeconds: 1 }));
  });

  test('parses --no-transcribe', () => {
    expect(parseRecordArgs(['--no-transcribe', '--duration', '1'])).toEqual(expectShape({ noTranscribe: true, durationSeconds: 1 }));
  });

  test('rejects --transcribe together with --no-transcribe', () => {
    expect(parseRecordArgs(['--transcribe', '--no-transcribe']).error).toMatch(/cannot use --transcribe together/);
  });

  test('parses --language for whisper.cpp -l', () => {
    expect(parseRecordArgs(['--language', 'hi', '--duration', '1'])).toEqual(
      expectShape({ transcribeLanguage: 'hi', durationSeconds: 1 }),
    );
  });

  test('parses --duration-minutes as seconds (e.g. 10 → 600)', () => {
    expect(parseRecordArgs(['--duration-minutes', '10', '--name', 'x'])).toEqual(
      expectShape({ durationSeconds: 600, name: 'x' }),
    );
    expect(parseRecordArgs(['--duration-minutes=0.5'])).toEqual(expectShape({ durationSeconds: 30 }));
  });

  test('rejects --duration together with --duration-minutes', () => {
    expect(parseRecordArgs(['--duration', '60', '--duration-minutes', '1']).error).toMatch(
      /cannot use --duration together with --duration-minutes/,
    );
  });

  test('parses --multilingual', () => {
    expect(parseRecordArgs(['--multilingual', '--duration', '1'])).toEqual(
      expectShape({ multilingual: true, durationSeconds: 1 }),
    );
  });

  test('parses --medium, -m, --large, -l', () => {
    expect(parseRecordArgs(['--medium', '--duration', '1'])).toEqual(
      expectShape({ transcribeModelPreset: 'medium', durationSeconds: 1 }),
    );
    expect(parseRecordArgs(['-m', '--duration', '1'])).toEqual(
      expectShape({ transcribeModelPreset: 'medium', durationSeconds: 1 }),
    );
    expect(parseRecordArgs(['--large', '--duration', '1'])).toEqual(
      expectShape({ transcribeModelPreset: 'large', durationSeconds: 1 }),
    );
    expect(parseRecordArgs(['-l', '--duration', '1'])).toEqual(
      expectShape({ transcribeModelPreset: 'large', durationSeconds: 1 }),
    );
  });

  test('rejects --medium with --large', () => {
    expect(parseRecordArgs(['--medium', '--large']).error).toMatch(/cannot use --medium together/);
  });
});
