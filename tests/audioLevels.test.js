const {
  peak16LE,
  toDb,
  renderBar,
  BAR_WIDTH,
  SILENCE_DB,
} = require('../src/audioLevels');

describe('peak16LE', () => {
  test('returns 0 for an all-zero buffer', () => {
    expect(peak16LE(Buffer.alloc(8))).toBe(0);
  });

  test('returns 0 for a buffer smaller than one sample', () => {
    expect(peak16LE(Buffer.alloc(1))).toBe(0);
    expect(peak16LE(Buffer.alloc(0))).toBe(0);
  });

  test('returns 1 for full-scale negative sample', () => {
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(-32768, 0);
    expect(peak16LE(buf)).toBe(1);
  });

  test('returns ~1 for full-scale positive sample', () => {
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(32767, 0);
    expect(peak16LE(buf)).toBeCloseTo(0.99997, 4);
  });

  test('picks the maximum absolute sample across a buffer', () => {
    const buf = Buffer.alloc(8);
    buf.writeInt16LE(100, 0);
    buf.writeInt16LE(-16384, 2);
    buf.writeInt16LE(50, 4);
    buf.writeInt16LE(0, 6);
    expect(peak16LE(buf)).toBeCloseTo(0.5, 4);
  });

  test('ignores a trailing odd byte without misreading samples', () => {
    const buf = Buffer.alloc(3);
    buf.writeInt16LE(16384, 0);
    buf[2] = 0xff;
    expect(peak16LE(buf)).toBeCloseTo(0.5, 4);
  });
});

describe('toDb', () => {
  test('returns SILENCE_DB for zero or negative input', () => {
    expect(toDb(0)).toBe(SILENCE_DB);
    expect(toDb(-0.5)).toBe(SILENCE_DB);
  });

  test('returns 0 dB for full scale', () => {
    expect(toDb(1)).toBe(0);
  });

  test('returns ~-6 dB for half scale', () => {
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  test('clamps to SILENCE_DB for inaudibly small values', () => {
    expect(toDb(0.0000001)).toBe(SILENCE_DB);
  });
});

describe('renderBar', () => {
  test('renders all empty for level 0', () => {
    expect(renderBar(0)).toBe('[' + '-'.repeat(BAR_WIDTH) + ']');
  });

  test('renders all filled for level 1', () => {
    expect(renderBar(1)).toBe('[' + '#'.repeat(BAR_WIDTH) + ']');
  });

  test('renders half filled for level 0.5', () => {
    const half = Math.round(0.5 * BAR_WIDTH);
    expect(renderBar(0.5)).toBe('[' + '#'.repeat(half) + '-'.repeat(BAR_WIDTH - half) + ']');
  });

  test('clamps inputs outside [0,1]', () => {
    expect(renderBar(2)).toBe('[' + '#'.repeat(BAR_WIDTH) + ']');
    expect(renderBar(-0.5)).toBe('[' + '-'.repeat(BAR_WIDTH) + ']');
  });

  test('respects a custom width', () => {
    expect(renderBar(0.5, { width: 10 })).toBe('[#####-----]');
  });
});
