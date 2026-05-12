require('./recorderPatch'); // must come before node-record-lpcm16 is loaded
const recorder = require('node-record-lpcm16');
const fs = require('fs');
const path = require('path');
const { finalizeWavHeader } = require('./wavHeaderFix');
const { PeakAccumulator } = require('./peakAccumulator');
const { buildSidecar, writeSidecar, sidecarPathFor } = require('./chunkSidecar');
const { transcribeFile, DEFAULT_MODEL_PATH } = require('./transcribe');
const { createTranscribeQueue } = require('./transcribeQueue');
const { formatChunkMarkdown, markdownPathFor } = require('./chunkMarkdown');

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

// Default queue worker: invoke transcribeFile, normalise whisper.cpp's .txt
// output to the canonical <basename>.txt path (so we don't have to care which
// filename convention the installed whisper-cli picked), and return the result.
// Extracted so the constructor can fall back to it when the caller doesn't
// inject a custom transcribeFn.
async function defaultTranscribeRun({ wav, model }, { transcribeFn = transcribeFile, fsImpl = fs } = {}) {
  const result = await transcribeFn({ wav, model });
  const ext = path.extname(wav);
  const stem = path.basename(wav, ext);
  const canonical = path.join(path.dirname(wav), `${stem}.txt`);
  if (result && result.txtPath && result.txtPath !== canonical) {
    try {
      fsImpl.writeFileSync(canonical, `${(result.text || '').trim()}\n`);
      try { fsImpl.unlinkSync(result.txtPath); } catch (_) { /* best-effort cleanup */ }
    } catch (err) {
      // If we can't write the canonical .txt, surface the original whisper output
      // location to the caller via the returned result so logs are still useful.
      return { ...result, normalizeError: err.message };
    }
  }
  return { ...result, txtPath: canonical };
}

// T-4: Write a <basename>.md sibling next to the WAV combining sidecar
// metadata with the transcript (when available) or a status stub. This runs
// in the queue worker so a successful transcription publishes both .txt and
// .md atomically from the user's point of view -- they appear as a pair.
//
// Best-effort: if reading the sidecar fails we fall back to a minimal
// {wav-basename} stub rather than crashing the worker. Writing the .md is
// itself wrapped in a try/catch by the caller (runWithMarkdown) so an
// unwritable destination never causes the queue to think transcription
// failed.
function writeChunkMarkdownSibling({
  wav,
  transcript = null,
  transcribeStatus = 'pending',
  transcribeError = null,
  fsImpl = fs,
}) {
  const sidecarPath = sidecarPathFor(wav);
  let sidecar;
  try {
    sidecar = JSON.parse(fsImpl.readFileSync(sidecarPath, 'utf8'));
  } catch (_) {
    // Sidecar missing / unreadable -- formatter handles a minimal duck.
    sidecar = { wav: path.basename(wav) };
  }
  const md = formatChunkMarkdown({
    sidecar,
    transcript,
    transcribeStatus,
    transcribeError,
  });
  const mdPath = markdownPathFor(wav);
  fsImpl.writeFileSync(mdPath, md);
  return mdPath;
}

// T-5: classify which transcription errors are worth retrying. Non-zero
// whisper-cli exit (transcribeFile attaches err.exitCode) is retryable
// because whisper occasionally hiccups on the first run -- model warmup,
// transient model-file mapping race, etc. Pre-flight validation errors
// (missing WAV / model / binary) are deterministic and will fail the same
// way every time, so we skip the retry to keep the failure-log readable.
function isRetryableTranscribeError(err) {
  if (!err) return false;
  if (err.exitCode != null) return true; // whisper-cli non-zero exit
  return false;
}

// T-5: single retry on non-zero whisper-cli exit. No backoff -- transcription
// is deterministic and a retry that helps will help on the next call. Logs
// both attempts via console.warn so the user can see what happened. The
// retry count is bounded to 1 by design; if it fails twice it will fail
// forever and we want the failure log to be readable, not a stack of
// repeated retries.
async function transcribeWithRetry(job, { transcribeFn, fsImpl, maxRetries = 1, logger = console } = {}) {
  let attempt = 0;
  let lastError;
  while (true) {
    try {
      return await defaultTranscribeRun(job, { transcribeFn, fsImpl });
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableTranscribeError(err)) {
        throw err;
      }
      attempt += 1;
      try {
        logger.warn(
          `[transcribe retry] ${path.relative(process.cwd(), job.wav)}: ` +
          `attempt ${attempt + 1}/${maxRetries + 1} after exit ${err.exitCode}`,
        );
      } catch (_) { /* logger threw -- not worth blocking the retry */ }
    }
  }
  /* unreachable */ /* eslint-disable-next-line no-unreachable */
  throw lastError;
}

// T-4: Compose the transcription work with the per-chunk .md write so the
// queue worker produces .txt + .md as a unit. Always attempts the .md write,
// even on transcription failure -- failure-stub markdown is still useful to
// the user. The .md write itself is best-effort; if it throws we log but do
// NOT mask the underlying transcription outcome.
async function runWithMarkdown(job, { transcribeFn, fsImpl = fs, maxRetries = 1, logger = console } = {}) {
  let transcribeResult = null;
  let transcribeError = null;
  try {
    transcribeResult = await transcribeWithRetry(job, { transcribeFn, fsImpl, maxRetries, logger });
  } catch (e) {
    transcribeError = e;
  }
  let mdPath = null;
  try {
    mdPath = writeChunkMarkdownSibling({
      wav: job.wav,
      transcript: transcribeResult ? transcribeResult.text : null,
      transcribeStatus: transcribeError ? 'failed' : 'ok',
      transcribeError: transcribeError ? transcribeError.message : null,
      fsImpl,
    });
  } catch (mdErr) {
    console.warn(`[markdown failed] ${path.relative(process.cwd(), job.wav)}: ${mdErr.message}`);
  }
  if (transcribeError) {
    // Decorate the thrown error with the .md path so onFailure can surface
    // that the user has a stub to look at.
    transcribeError.mdPath = mdPath;
    throw transcribeError;
  }
  return { ...transcribeResult, mdPath };
}

class AudioRecorder {
  constructor(options = {}) {
    const {
      idleThreshold,
      idleSilenceSeconds,
      maxChunkSeconds,
      transcribe = false,
      transcribeModel = DEFAULT_MODEL_PATH,
      transcribeFn,
      transcribeLogger = null,
      transcribeMinPeak = 0.005,
      transcribeQueueMax = 5,
      transcribeRetries = 1,
      ...rest
    } = options;
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

    // Transcription wiring. Off by default so existing callers see byte-identical
    // capture behaviour. Each enabled instance owns its own queue, so two
    // concurrent recorders don't share a worker.
    this.transcribe = transcribe === true;
    this.transcribeModel = transcribeModel;
    // T-5: peak gating threshold. Chunks whose sidecar peak < this are
    // marked 'skipped' with a stub .md and never enter the transcription
    // queue. Default 0.005 (~-46 dBFS) is well above typical room hum but
    // below conversational speech. Set to 0 to disable the gate (every
    // chunk goes to whisper).
    this.transcribeMinPeak = Number.isFinite(transcribeMinPeak) && transcribeMinPeak >= 0
      ? transcribeMinPeak
      : 0.005;
    // T-5: backpressure threshold. When queue length exceeds this, fire a
    // one-shot warn (re-armed when the queue drains). Default 5; set to 0
    // to disable the warning.
    this.transcribeQueueMax = Number.isFinite(transcribeQueueMax) && transcribeQueueMax >= 0
      ? transcribeQueueMax
      : 5;
    // T-5: max retries per chunk. 1 = whisper-cli is tried twice on non-zero
    // exit. Set to 0 to disable retries entirely (one attempt only).
    this.transcribeRetries = Number.isFinite(transcribeRetries) && transcribeRetries >= 0
      ? Math.floor(transcribeRetries)
      : 1;
    this.transcribeQueue = null;
    if (this.transcribe) {
      const runFn = (job) => runWithMarkdown(job, {
        transcribeFn,
        maxRetries: this.transcribeRetries,
      });
      const logger = transcribeLogger || {
        onSuccess: (job, result) => {
          // Prefer announcing the .md (T-4's user-facing artifact); fall back
          // to the .txt if the md write failed.
          const announcePath = (result && result.mdPath) || (result && result.txtPath);
          if (announcePath) {
            const rel = path.relative(process.cwd(), announcePath);
            console.log(`[transcribed] ${rel}`);
          }
        },
        onFailure: (job, error) => {
          const rel = path.relative(process.cwd(), job.wav);
          const stubNote = error && error.mdPath ? ' (md stub written)' : '';
          console.warn(`[transcribe failed] ${rel}: ${error.message}${stubNote}`);
        },
        onOverflow: (length) => {
          console.warn(
            `[transcribe backlog] queue depth ${length} exceeds --transcribe-queue-max ` +
            `${this.transcribeQueueMax}. Capture is outrunning transcription; consider ` +
            'raising --silence, lowering --max-chunk-seconds, or using a smaller model.',
          );
        },
      };
      this.transcribeQueue = createTranscribeQueue({
        run: runFn,
        onSuccess: logger.onSuccess,
        onFailure: logger.onFailure,
        warnAt: this.transcribeQueueMax,
        onOverflow: logger.onOverflow,
      });
    }
  }

  // Wait for any in-flight or queued transcriptions to settle. Safe to call
  // when transcription is off (returns a resolved promise). The CLI shutdown
  // path awaits this before process.exit so we don't kill whisper-cli mid-job.
  drainTranscriptions() {
    if (!this.transcribeQueue) return Promise.resolve();
    return this.transcribeQueue.drain();
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
      let sidecarPayload = null;
      if (sidecar && sidecar.peakAcc && sidecar.format) {
        try {
          sidecarPayload = buildSidecar({
            wavPath: filePath,
            start: sidecar.chunkStart,
            end: closedAt,
            fileSize: finalizeResult ? finalizeResult.fileSize : size,
            dataPayloadOffset: finalizeResult ? finalizeResult.dataPayloadOffset : WAV_HEADER_BYTES,
            format: sidecar.format,
            peak: sidecar.peakAcc.peak,
            peakDb: sidecar.peakAcc.peakDb,
          });
          writeSidecar(filePath, sidecarPayload);
        } catch (err) {
          console.warn(`Sidecar write skipped for ${filePath}: ${err.message}`);
        }
      }
      // Hand the just-finalised WAV off to the transcription queue if
      // transcription is enabled. The queue is serial -- two long chunks in a
      // row will run back-to-back rather than fighting for CPU. We do this
      // AFTER the sidecar write so consumers reading the .txt can rely on the
      // .json sibling already being on disk.
      //
      // T-5: peak gating. If the sidecar says the chunk's peak is below
      // `transcribeMinPeak` (default 0.005), skip the queue entirely and
      // write a `_skipped: ..._` .md stub immediately. Saves whisper.cpp
      // CPU on dead-air chunks and gives the user explicit visibility into
      // why a particular chunk's .txt is missing.
      if (this.transcribeQueue) {
        const peak = sidecarPayload != null ? sidecarPayload.peak : null;
        const shouldSkip = this.transcribeMinPeak > 0
          && peak != null
          && Number.isFinite(peak)
          && peak < this.transcribeMinPeak;
        if (shouldSkip) {
          const reason = `peak ${peak.toFixed(4)} below --transcribe-min-peak ${this.transcribeMinPeak}`;
          try {
            writeChunkMarkdownSibling({
              wav: filePath,
              transcribeStatus: 'skipped',
              transcribeError: reason,
            });
          } catch (mdErr) {
            console.warn(`[markdown failed] ${path.relative(process.cwd(), filePath)}: ${mdErr.message}`);
          }
          console.log(
            `[transcribe skipped] ${path.relative(process.cwd(), filePath)} (${reason})`,
          );
        } else {
          this.transcribeQueue.enqueue({ wav: filePath, model: this.transcribeModel });
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
module.exports.defaultTranscribeRun = defaultTranscribeRun;
module.exports.runWithMarkdown = runWithMarkdown;
module.exports.writeChunkMarkdownSibling = writeChunkMarkdownSibling;
module.exports.transcribeWithRetry = transcribeWithRetry;
module.exports.isRetryableTranscribeError = isRetryableTranscribeError;