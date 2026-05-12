const fs = require('fs');
const os = require('os');
const path = require('path');
const { finalizeWavHeader } = require('../src/wavHeaderFix');

function buildWav({ riffSize, dataSize, dataLength = 32, extraChunks = [] }) {
  const fmtChunkSize = 16;
  const extraSize = extraChunks.reduce((s, c) => s + 8 + c.size, 0);
  const headerLen = 12 + (8 + fmtChunkSize) + extraSize + 8; // up to start of data payload
  const buf = Buffer.alloc(headerLen + dataLength);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(riffSize, 4);
  buf.write('WAVE', 8, 'ascii');

  let cursor = 12;
  buf.write('fmt ', cursor, 'ascii'); cursor += 4;
  buf.writeUInt32LE(fmtChunkSize, cursor); cursor += 4;
  buf.writeUInt16LE(1, cursor); cursor += 2;       // PCM
  buf.writeUInt16LE(1, cursor); cursor += 2;       // mono
  buf.writeUInt32LE(16000, cursor); cursor += 4;   // 16 kHz
  buf.writeUInt32LE(32000, cursor); cursor += 4;   // byte rate
  buf.writeUInt16LE(2, cursor); cursor += 2;       // block align
  buf.writeUInt16LE(16, cursor); cursor += 2;      // bits per sample

  for (const c of extraChunks) {
    buf.write(c.id, cursor, 'ascii'); cursor += 4;
    buf.writeUInt32LE(c.size, cursor); cursor += 4;
    cursor += c.size;
  }

  buf.write('data', cursor, 'ascii'); cursor += 4;
  buf.writeUInt32LE(dataSize, cursor); cursor += 4;
  for (let i = 0; i < dataLength; i++) buf[cursor + i] = (i * 7) & 0xff;
  return buf;
}

describe('finalizeWavHeader', () => {
  let tmpDir;
  let filePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavfix-'));
    filePath = path.join(tmpDir, 'test.wav');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  test('rewrites a near-2GiB placeholder to the real sizes', () => {
    const dataLength = 1024;
    const wav = buildWav({ riffSize: 0x7FFFF000, dataSize: 0x7FFFF000, dataLength });
    fs.writeFileSync(filePath, wav);

    const result = finalizeWavHeader(filePath);

    expect(result.dataSizeBefore).toBe(0x7FFFF000);
    expect(result.riffSizeBefore).toBe(0x7FFFF000);
    expect(result.dataSizeAfter).toBe(dataLength);
    expect(result.riffSizeAfter).toBe(wav.length - 8);

    const fixed = fs.readFileSync(filePath);
    expect(fixed.readUInt32LE(4)).toBe(wav.length - 8);
    // data chunk size lives right before the payload (8 bytes earlier than payload offset)
    expect(fixed.readUInt32LE(result.dataPayloadOffset - 4)).toBe(dataLength);
    // first sample byte is unchanged
    expect(fixed[result.dataPayloadOffset]).toBe(0);
  });

  test('is idempotent: re-running on a correct file is a no-op', () => {
    const dataLength = 64;
    const wav = buildWav({
      riffSize: 12 + 24 + 8 + dataLength - 8, // standard layout
      dataSize: dataLength,
      dataLength,
    });
    fs.writeFileSync(filePath, wav);

    const before = fs.readFileSync(filePath);
    finalizeWavHeader(filePath);
    const after = fs.readFileSync(filePath);
    expect(after).toEqual(before);
  });

  test('finds data chunk past intermediate extra chunks', () => {
    const dataLength = 100;
    const wav = buildWav({
      riffSize: 0x7FFFF000,
      dataSize: 0x7FFFF000,
      dataLength,
      extraChunks: [{ id: 'JUNK', size: 16 }, { id: 'LIST', size: 24 }],
    });
    fs.writeFileSync(filePath, wav);

    const result = finalizeWavHeader(filePath);
    expect(result.dataSizeAfter).toBe(dataLength);
    const fixed = fs.readFileSync(filePath);
    expect(fixed.readUInt32LE(result.dataPayloadOffset - 4)).toBe(dataLength);
  });

  test('throws on non-RIFF input', () => {
    fs.writeFileSync(filePath, Buffer.alloc(200, 0xab));
    expect(() => finalizeWavHeader(filePath)).toThrow(/RIFF/i);
  });

  test('throws when the file is too small to be a WAV', () => {
    fs.writeFileSync(filePath, Buffer.from('shorty'));
    expect(() => finalizeWavHeader(filePath)).toThrow(/too small/i);
  });

  test('throws when no data chunk is present', () => {
    // Build a header-only WAV with fmt but no data chunk
    const noDataLen = 12 + 8 + 16; // RIFF/WAVE + 'fmt ' chunk
    const buf = Buffer.alloc(noDataLen + 200, 0); // pad with zeros so >= 44 bytes
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(noDataLen + 200 - 8, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    // No 'data' chunk follows; the rest is zero padding which won't match 'data'.
    fs.writeFileSync(filePath, buf);
    expect(() => finalizeWavHeader(filePath)).toThrow(/data chunk/i);
  });
});
