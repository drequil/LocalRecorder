// Running peak amplitude across a sequence of int16-LE PCM buffers, with an
// optional `skipBytes` prefix that's ignored (so we can feed it the entire
// sox stdout stream including the WAV header without contaminating the peak
// with header bytes interpreted as samples).
//
// Intentionally uses the same peak16LE primitive that the level meter does
// (MS-3), so the peak values reported in chunk sidecars are directly
// comparable to what the user saw on screen during `listen`.

const { peak16LE, toDb } = require('./audioLevels');

class PeakAccumulator {
  constructor({ skipBytes = 0 } = {}) {
    if (!Number.isFinite(skipBytes) || skipBytes < 0) {
      throw new RangeError(`PeakAccumulator: skipBytes must be a non-negative finite number, got ${skipBytes}`);
    }
    this.skipBytes = skipBytes;
    this.bytesSeen = 0;
    this.maxPeak = 0;
  }

  push(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return;
    const startInBuffer = Math.max(0, this.skipBytes - this.bytesSeen);
    this.bytesSeen += buffer.length;
    if (startInBuffer >= buffer.length) return;
    const slice = startInBuffer === 0 ? buffer : buffer.subarray(startInBuffer);
    if (slice.length < 2) return; // need at least one full sample
    const peak = peak16LE(slice);
    if (peak > this.maxPeak) this.maxPeak = peak;
  }

  get peak() {
    return this.maxPeak;
  }

  get peakDb() {
    return toDb(this.maxPeak);
  }
}

module.exports = { PeakAccumulator };
