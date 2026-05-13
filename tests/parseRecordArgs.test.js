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
    transcribeMinPeak: null,
    transcribeQueueMax: null,
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
});
