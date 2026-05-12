const { parseRecordArgs } = require('../src/index');

describe('parseRecordArgs', () => {
  test('returns output with no duration when only a path is provided', () => {
    expect(parseRecordArgs(['out.wav'])).toEqual({ output: 'out.wav', durationSeconds: null });
  });

  test('parses --duration N before the output path', () => {
    expect(parseRecordArgs(['--duration', '5', 'out.wav'])).toEqual({ output: 'out.wav', durationSeconds: 5 });
  });

  test('parses --duration N after the output path', () => {
    expect(parseRecordArgs(['out.wav', '--duration', '5'])).toEqual({ output: 'out.wav', durationSeconds: 5 });
  });

  test('parses --duration=N form', () => {
    expect(parseRecordArgs(['out.wav', '--duration=2.5'])).toEqual({ output: 'out.wav', durationSeconds: 2.5 });
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

  test('errors when output is missing', () => {
    expect(parseRecordArgs([]).error).toMatch(/output file path required/);
    expect(parseRecordArgs(['--duration', '5']).error).toMatch(/output file path required/);
  });

  test('errors on unknown flags', () => {
    expect(parseRecordArgs(['out.wav', '--bogus']).error).toMatch(/unknown flag/);
  });

  test('errors on extra positional arguments', () => {
    expect(parseRecordArgs(['a.wav', 'b.wav']).error).toMatch(/extra argument/);
  });
});
