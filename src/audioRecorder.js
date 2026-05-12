require('./recorderPatch'); // must come before node-record-lpcm16 is loaded
const recorder = require('node-record-lpcm16');
const fs = require('fs');
const path = require('path');
const { finalizeWavHeader } = require('./wavHeaderFix');
const { PeakAccumulator } = require('./peakAccumulator');
const { buildSidecar, writeSidecar } = require('./chunkSidecar');

const WAV_HEADER_BYTES = 44; // canonical 44-byte preamble for our format

// Single source of truth for the capture format we hand off to the transcription
// stage. Whisper expects 16 kHz mono 16-bit signed PCM; producing anything else
// forces a resample step downstream. Keep this object frozen so callers cannot
// accidentally mutate the shared default.
const WHISPER_AUDIO_FORMAT = Object.freeze({
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  encoding: 'signed-integer',
});

function defaultChunkFilename(now = new Date(), suffix = '') {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(now.getMilliseconds(), 3)}`;
  return `chunk-${ts}${suffix}.wav`;
}

class AudioRecorder {
  constructor(options = {}) {
    const { idleThreshold, idleSilenceSeconds, maxChunkSeconds, ...rest } = options;
    this.options = {
      ...WHISPER_AUDIO_FORMAT,
      ...rest,
    };
    this.idleThreshold = Number.isFinite(idleThreshold) ? idleThreshold : 0.5;
    this.idleSilenceSeconds = Number.isFinite(idleSilenceSeconds)
      ? String(idleSilenceSeconds)
      : '1.0';
    // 0 / null / undefined => no upper bound on chunk length.
    this.maxChunkSeconds = Number.isFinite(maxChunkSeconds) && maxChunkSeconds > 0
      ? maxChunkSeconds
      : 0;
    this.recording = null;
    this.fileStream = null;
    this.fileStreamPath = null;
    this.idle = false;
    this.listening = false;
  }

  // Attach a one-shot finalizer that rewrites the WAV header's RIFF + data
  // chunk sizes once the underlying fs.WriteStream finishes flushing. We also
  // remove zero-byte files here (sox didn't emit any audio before shutdown).
  //
  // When `sidecar` is supplied (idle-chunk path), we additionally write a
  // companion `<basename>.json` capturing chunk start/end timestamps, peak
  // amplitude, audio format, and byte count. The sidecar is the MS-8 contract;
  // downstream tooling (Whisper, search index, heat trend) reads this without
  // touching the audio bytes.
  _attachFinalize(fileStream, filePath, sidecar = null) {
    if (!fileStream || typeof fileStream.once !== 'function') return;
    if (typeof filePath !== 'string') return;
    fileStream.once('close', () => {
      const closedAt = new Date();
      let size = -1;
      try {
        size = fs.statSync(filePath).size;
      } catch (_) {
        return;
      }
      if (size === 0) {
        try { fs.unlinkSync(filePath); } catch (_) { /* leave it */ }
        return;
      }
      let finalizeResult = null;
      if (/\.wav$/i.test(filePath)) {
        try {
          finalizeResult = finalizeWavHeader(filePath);
        } catch (err) {
          console.warn(`WAV header finalize skipped for ${filePath}: ${err.message}`);
        }
      }
      if (sidecar && sidecar.peakAcc && sidecar.format) {
        try {
          const payload = buildSidecar({
            wavPath: filePath,
            start: sidecar.chunkStart,
            end: closedAt,
            fileSize: finalizeResult ? finalizeResult.fileSize : size,
            dataPayloadOffset: finalizeResult ? finalizeResult.dataPayloadOffset : WAV_HEADER_BYTES,
            format: sidecar.format,
            peak: sidecar.peakAcc.peak,
            peakDb: sidecar.peakAcc.peakDb,
          });
          writeSidecar(filePath, payload);
        } catch (err) {
          console.warn(`Sidecar write skipped for ${filePath}: ${err.message}`);
        }
      }
    });
  }

  start(outputPath, options = {}) {
    if (this.recording || this.idle || this.listening) {
      throw new Error('Recording already in progress');
    }

    const writeSidecar = options.writeSidecar !== false; // default ON
    const chunkStart = new Date();
    const peakAcc = writeSidecar ? new PeakAccumulator({ skipBytes: WAV_HEADER_BYTES }) : null;

    this.fileStream = fs.createWriteStream(outputPath);
    this.fileStreamPath = outputPath;
    this._attachFinalize(
      this.fileStream,
      outputPath,
      writeSidecar ? { chunkStart, peakAcc, format: this.options } : null,
    );
    this.recording = recorder.record({ ...this.options, audioType: 'wav' });
    const stream = this.recording.stream();
    if (peakAcc) stream.on('data', (chunk) => peakAcc.push(chunk));
    stream.pipe(this.fileStream);
    stream.on('error', (err) => {
      // Intentional stop() nulls this.recording before sox's error fires.
      if (!this.recording) return;
      console.error('Record stream error:', err);
      this.recording = null;
      if (this.fileStream) {
        try { this.fileStream.end(); } catch (_) { /* already closed */ }
        this.fileStream = null;
        this.fileStreamPath = null;
      }
    });

    console.log('Recording started to', outputPath);
  }

  listen(handler) {
    if (this.recording || this.idle || this.listening) {
      throw new Error('Recording already in progress');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('listen(handler): handler must be a function');
    }
    this.listening = true;
    this.recording = recorder.record({ ...this.options, audioType: 'raw' });
    const stream = this.recording.stream();
    stream.on('data', handler);
    stream.on('error', (err) => {
      // After stop() runs, this.recording is null -- treat that as an
      // intentional shutdown and stay quiet; sox's exit on kill is not news.
      if (!this.recording) return;
      console.error('Listen stream error:', err);
      this.listening = false;
      this.recording = null;
    });
    console.log('Listening (no file written)');
  }

  idleListen(directory) {
    if (this.recording || this.idle || this.listening) {
      throw new Error('Recording already in progress');
    }
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new TypeError('idleListen(directory): directory must be a non-empty string');
    }

    fs.mkdirSync(directory, { recursive: true });

    this.idle = true;
    this.chunks = [];
    const usedNames = new Set();

    const allocateChunkPath = () => {
      const now = new Date();
      let candidate = defaultChunkFilename(now);
      let counter = 2;
      while (usedNames.has(candidate)) {
        candidate = defaultChunkFilename(now, `-${counter}`);
        counter += 1;
      }
      usedNames.add(candidate);
      return path.join(directory, candidate);
    };

    const recordChunk = () => {
      if (!this.idle) return;
      const chunkPath = allocateChunkPath();
      this.chunks.push(chunkPath);
      const chunkStart = new Date();
      const peakAcc = new PeakAccumulator({ skipBytes: WAV_HEADER_BYTES });
      this.fileStream = fs.createWriteStream(chunkPath);
      this.fileStreamPath = chunkPath;
      this._attachFinalize(this.fileStream, chunkPath, {
        chunkStart,
        peakAcc,
        format: this.options,
      });
      this.recording = recorder.record({
        ...this.options,
        audioType: 'wav',
        endOnSilence: true,
        threshold: this.idleThreshold,
        silence: this.idleSilenceSeconds,
      });
      const stream = this.recording.stream();

      let maxChunkTimer = null;
      if (this.maxChunkSeconds > 0) {
        maxChunkTimer = setTimeout(() => {
          // Time's up. Kill sox; its stdout 'end' will trigger the rotation
          // path just like a natural silence-detector exit would.
          if (this.recording && typeof this.recording.stop === 'function') {
            console.log(`Max chunk seconds (${this.maxChunkSeconds}) reached, rotating: ${path.basename(chunkPath)}`);
            try { this.recording.stop(); } catch (_) { /* already gone */ }
          }
        }, this.maxChunkSeconds * 1000);
      }
      const clearMaxChunkTimer = () => {
        if (maxChunkTimer) {
          clearTimeout(maxChunkTimer);
          maxChunkTimer = null;
        }
      };

      stream.on('data', (chunk) => peakAcc.push(chunk));
      stream.pipe(this.fileStream);
      stream.on('error', (err) => {
        // If stop() cleared this.recording, the error came from an intentional
        // kill -- stay quiet and let the shutdown path do its thing.
        clearMaxChunkTimer();
        if (!this.recording) return;
        console.error('Idle-listen stream error:', err);
        this.idle = false;
        this.recording = null;
        if (this.fileStream) {
          try { this.fileStream.end(); } catch (_) { /* already closed */ }
          this.fileStream = null;
          this.fileStreamPath = null;
        }
      });

      stream.on('end', () => {
        // Either sox detected silence and exited cleanly, or stop()/max-chunk
        // killed it. Either way, close the current chunk; only schedule the
        // next one if we're still in idle mode (i.e. stop() didn't run).
        clearMaxChunkTimer();
        console.log(`Silence detected, rotating chunk: ${path.basename(chunkPath)}`);
        this.recording = null;
        if (this.fileStream) {
          this.fileStream.end();
          this.fileStream = null;
          this.fileStreamPath = null;
        }
        if (this.idle) {
          setTimeout(recordChunk, 100);
        }
      });

      console.log(`Idle chunk started: ${path.basename(chunkPath)}`);
    };

    recordChunk();
  }

  stop() {
    if (!this.recording && !this.idle && !this.listening) {
      throw new Error('No recording in progress');
    }
    this.idle = false;
    this.listening = false;
    if (this.recording) {
      if (typeof this.recording.stop === 'function') {
        this.recording.stop();
      }
      this.recording = null;
    }
    if (this.fileStream) {
      // The finalize listener was attached in start() / idleListen() via
      // _attachFinalize, so we just need to flush the stream here.
      this.fileStream.end();
      this.fileStream = null;
      this.fileStreamPath = null;
    }
    console.log('Recording stopped');
  }
}

module.exports = AudioRecorder;
module.exports.defaultChunkFilename = defaultChunkFilename;
module.exports.WHISPER_AUDIO_FORMAT = WHISPER_AUDIO_FORMAT;