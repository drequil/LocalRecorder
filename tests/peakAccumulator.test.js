const { PeakAccumulator } = require('../src/peakAccumulator');

function int16BufferFromSamples(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2);
  return buf;
}

describe('PeakAccumulator', () => {
  test('reports zero peak before any data is pushed', () => {
    const acc = new PeakAccumulator();
    expect(acc.peak).toBe(0);
    expect(acc.peakDb).toBeLessThan(-100);
  });

  test('tracks the running max peak across multiple buffers', () => {
    const acc = new PeakAccumulator();
    acc.push(int16BufferFromSamples([0, 100, -200])); // peak ~200/32768
    acc.push(int16BufferFromSamples([50, -50, 10])); // smaller
    acc.push(int16BufferFromSamples([0, 5000, 0])); // larger
    expect(acc.peak).toBeCloseTo(5000 / 32768, 6);
  });

  test('skips a header prefix that spans the first push only', () => {
    const acc = new PeakAccumulator({ skipBytes: 44 });
    // Pretend 44 bytes of WAV header (any junk) then real samples.
    const junk = Buffer.alloc(44, 0xff);
    const samples = int16BufferFromSamples([1000, -2000, 1500]);
    acc.push(Buffer.concat([junk, samples]));
    expect(acc.peak).toBeCloseTo(2000 / 32768, 6);
  });

  test('skips a header prefix that spans multiple pushes', () => {
    const acc = new PeakAccumulator({ skipBytes: 44 });
    acc.push(Buffer.alloc(30, 0xff)); // still inside skip region
    acc.push(Buffer.alloc(10, 0xff)); // still inside (total 40 < 44)
    acc.push(Buffer.concat([Buffer.alloc(4, 0xff), int16BufferFromSamples([0, 3000, -3500])]));
    expect(acc.peak).toBeCloseTo(3500 / 32768, 6);
  });

  test('handles minimum sample width gracefully', () => {
    const acc = new PeakAccumulator();
    acc.push(Buffer.from([0x10])); // single byte, can't form an int16
    expect(acc.peak).toBe(0);
  });

  test('rejects negative skipBytes', () => {
    expect(() => new PeakAccumulator({ skipBytes: -1 })).toThrow(RangeError);
  });
});
