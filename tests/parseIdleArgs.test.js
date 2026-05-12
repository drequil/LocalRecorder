const { parseIdleArgs, parseListenArgs } = require('../src/index');

describe('parseIdleArgs', () => {
  test('requires a directory argument', () => {
    expect(parseIdleArgs([]).error).toMatch(/output directory required/);
    expect(parseIdleArgs(['--threshold', '0.1']).error).toMatch(/output directory required/);
  });

  test('returns directory with null knobs by default', () => {
    expect(parseIdleArgs(['./recordings'])).toEqual({
      directory: './recordings',
      idleThreshold: null,
      idleSilenceSeconds: null,
      device: null,
      maxChunkSeconds: null,
    });
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

  test('parses --silence as a positive number', () => {
    expect(parseIdleArgs(['./r', '--silence', '2.5']).idleSilenceSeconds).toBe(2.5);
    expect(parseIdleArgs(['./r', '--silence', '0']).error).toMatch(/positive number/);
  });

  test('parses --device as a string', () => {
    expect(parseIdleArgs(['./r', '--device', '5']).device).toBe('5');
    expect(parseIdleArgs(['./r', '--device', 'USB Mic']).device).toBe('USB Mic');
  });

  test('parses --max-chunk-seconds as a positive number', () => {
    expect(parseIdleArgs(['./r', '--max-chunk-seconds', '60']).maxChunkSeconds).toBe(60);
    expect(parseIdleArgs(['./r', '--max-chunk-seconds', '-1']).error).toMatch(/positive number/);
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
