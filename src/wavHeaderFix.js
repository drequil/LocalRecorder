// Finalizes a WAV file's RIFF and `data` chunk size fields.
//
// Background: when sox writes WAV to its stdout (which we pipe to a file),
// it cannot seek back to patch the sizes after recording finishes, so it
// emits a near-int32-max (~2 GiB) placeholder. Most players are lenient and
// derive the real length from the file size, but strict parsers reject it.
// This helper rewrites both size fields in-place to match the on-disk reality.
//
// The implementation walks the RIFF chunk list (no assumption that `data` is
// at the canonical 36-byte offset) and tolerates unknown chunks before it.

const fs = require('fs');

const HEADER_SCAN_LIMIT = 8192; // bytes; well past any reasonable WAV preamble

function finalizeWavHeader(filePath) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  if (fileSize < 44) {
    throw new Error(`file too small to be a WAV (${fileSize} bytes): ${filePath}`);
  }

  const fd = fs.openSync(filePath, 'r+');
  try {
    const scan = Buffer.alloc(Math.min(HEADER_SCAN_LIMIT, fileSize));
    fs.readSync(fd, scan, 0, scan.length, 0);

    if (scan.toString('ascii', 0, 4) !== 'RIFF') {
      throw new Error(`not a RIFF file (first 4 bytes: ${JSON.stringify(scan.toString('ascii', 0, 4))})`);
    }
    if (scan.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`not a WAVE container (bytes 8-12: ${JSON.stringify(scan.toString('ascii', 8, 12))})`);
    }

    let cursor = 12;
    let dataChunkSizeOffset = -1;
    let dataPayloadOffset = -1;
    let dataSizeBefore = -1;

    while (cursor + 8 <= scan.length) {
      const chunkId = scan.toString('ascii', cursor, cursor + 4);
      const chunkSize = scan.readUInt32LE(cursor + 4);
      if (chunkId === 'data') {
        dataChunkSizeOffset = cursor + 4;
        dataPayloadOffset = cursor + 8;
        dataSizeBefore = chunkSize;
        break;
      }
      cursor += 8 + chunkSize;
      if (chunkSize % 2 === 1) cursor += 1; // RIFF word alignment
    }

    if (dataPayloadOffset < 0) {
      throw new Error(`no data chunk found in first ${HEADER_SCAN_LIMIT} bytes of ${filePath}`);
    }

    const trueDataSize = fileSize - dataPayloadOffset;
    const trueRiffSize = fileSize - 8;
    const riffSizeBefore = scan.readUInt32LE(4);

    const sizeBuf = Buffer.alloc(4);

    sizeBuf.writeUInt32LE(trueRiffSize, 0);
    fs.writeSync(fd, sizeBuf, 0, 4, 4);

    sizeBuf.writeUInt32LE(trueDataSize, 0);
    fs.writeSync(fd, sizeBuf, 0, 4, dataChunkSizeOffset);

    return {
      filePath,
      fileSize,
      dataPayloadOffset,
      riffSizeBefore,
      riffSizeAfter: trueRiffSize,
      dataSizeBefore,
      dataSizeAfter: trueDataSize,
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { finalizeWavHeader, HEADER_SCAN_LIMIT };
