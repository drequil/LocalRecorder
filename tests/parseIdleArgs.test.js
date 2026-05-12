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
