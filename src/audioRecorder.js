require('./recorderPatch'); // must come before node-record-lpcm16 is loaded
const recorder = require('node-record-lpcm16');
const fs = require('fs');
const path = require('path');
const { peak16LE, toDb } = require('./audioLevels');
const { filterHallucinations } = require('./hallucination');
const { finalizeWavHeaderAsync } = require('./wavHeaderFix');
const { PeakAccumulator } = require('./peakAccumulator');
const { buildSidecar, sidecarPathFor } = require('./chunkSidecar');
const { transcribeFile, DEFAULT_MODEL_PATH } = require('./transcribe');
const { createTranscribeQueue } = require('./transcribeQueue');
const { formatChunkMarkdown, markdownPathFor } = require('./chunkMarkdown');
const { appendChunkToSessionHtml } = require('./sessionTranscript');
const { trace } = require('./trace');

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
async function defaultTranscribeRun({ wav, model, language, threads, noSpeechThreshold, entropyThreshold }, { transcribeFn = transcribeFile, fsImpl = fs } = {}) {
  const result = await transcribeFn({ wav, model, language, threads, noSpeechThreshold, entropyThreshold });

  // Apply hallucination filter.  If whisper.cpp produced text, strip any lines
  // that match known hallucination patterns (e.g. repeated "Thank you.").
  // When ALL lines were hallucinated, replace the .txt with an empty file so
  // consumers see a clean gap rather than fake content.
  let filteredText = result ? (result.text || '') : '';
  let hallucinationFiltered = false;
  if (filteredText.trim().length > 0) {
    const fr = filterHallucinations(filteredText);
    if (fr.removedCount > 0) {
      filteredText = fr.text;
      hallucinationFiltered = true;
      trace('hallucination', 'filtered', {
        wav: path.basename(wav),
        removedCount: fr.removedCount,
        totalLines: fr.totalLines,
        allRemoved: fr.allRemoved,
      });
    }
  }

  const ext = path.extname(wav);
  const stem = path.basename(wav, ext);
  const canonical = path.join(path.dirname(wav), `${stem}.txt`);
  const needsWrite = hallucinationFiltered || (result && result.txtPath && result.txtPath !== canonical);
  if (needsWrite) {
    try {
      fsImpl.writeFileSync(canonical, filteredText.length > 0 ? `${filteredText.trim()}\n` : '');
      if (result && result.txtPath && result.txtPath !== canonical) {
        try { fsImpl.unlinkSync(result.txtPath); } catch (_) { /* best-effort cleanup */ }
      }
    } catch (err) {
      return { ...result, text: filteredText, normalizeError: err.message };
    }
  }
  return { ...result, text: filteredText, txtPath: canonical };
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
  trace('job', 'runWithMarkdown start', { wav: job.wav, model: job.model, language: job.language || null });
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
  // Session-level HTML transcript: a single file per session that grows live.
  // Best-effort like the .md write -- failures here are logged but never
  // mask the transcription outcome.
  let htmlPath = null;
  try {
    const sidecarOnDisk = readSidecarBestEffort(job.wav, fsImpl);
    htmlPath = appendChunkToSessionHtml({
      wav: job.wav,
      sidecar: sidecarOnDisk,
      transcript: transcribeResult ? transcribeResult.text : null,
      transcribeStatus: transcribeError ? 'failed' : 'ok',
      transcribeError: transcribeError ? transcribeError.message : null,
      fsImpl,
    });
  } catch (htmlErr) {
    console.warn(`[session html failed] ${path.relative(process.cwd(), job.wav)}: ${htmlErr.message}`);
  }
  if (transcribeError) {
    // Decorate the thrown error with the .md / .html paths so onFailure can
    // surface that the user has stubs to look at.
    transcribeError.mdPath = mdPath;
    transcribeError.htmlPath = htmlPath;
    trace('job', 'runWithMarkdown failed', { wav: job.wav, message: transcribeError.message });
    throw transcribeError;
  }
  trace('job', 'runWithMarkdown ok', {
    wav: job.wav,
    textChars: transcribeResult && transcribeResult.text ? transcribeResult.text.length : 0,
    mdPath,
    htmlPath,
  });
  return { ...transcribeResult, mdPath, htmlPath };
}

// Shared helper: read the sidecar JSON for a wav, or return a minimal duck if
// the file is missing. Used by both writeChunkMarkdownSibling and the session
// HTML appender so they agree on the fallback shape.
function readSidecarBestEffort(wav, fsImpl = fs) {
  try {
    const text = fsImpl.readFileSync(sidecarPathFor(wav), 'utf8');
    return JSON.parse(text);
  } catch (_) {
    return { wav: path.basename(wav) };
  }
}

class AudioRecorder {
  constructor(options = {}) {
    const {
      idleThreshold,
      idleSilenceSeconds,
      maxChunkSeconds,
      transcribe = false,
      transcribeModel = DEFAULT_MODEL_PATH,
      transcribeLanguage = null,
      transcribeThreads = null,
      noSpeechThreshold = null,
      entropyThreshold = null,
      useWhisperServer = true,
      transcribeFn,
      transcribeLogger = null,
      transcribeMinPeak = 0.02,
      transcribeQueueMax = 5,
      transcribeRetries = 1,
      peakHandler,
      chunkStartedHandler,
      ...rest
    } = options;
    this.peakHandler = typeof peakHandler === 'function' ? peakHandler : null;
    this.chunkStartedHandler = typeof chunkStartedHandler === 'function' ? chunkStartedHandler : null;
    this.options = {
      ...WHISPER_AUDIO_FORMAT,
      ...rest,
    };
    // Idle defaults: sox treats signal *below* this % of peak as silence. A high
    // default (e.g. 0.5%) caused mid-speech chunking when softer syllables dipped.
    this.idleThreshold = Number.isFinite(idleThreshold) ? idleThreshold : 0.1;
    this.idleSilenceSeconds = Number.isFinite(idleSilenceSeconds)
      ? String(idleSilenceSeconds)
      : '2';
    // `--silence 0` is the explicit "disable sox silence detector" signal --
    // chunks rotate only on --max-chunk-seconds. Useful when the detector is
    // unreliable in the user's audio environment (e.g. fluctuating noise floor
    // around the threshold causing premature rotation).
    this.idleSilenceDisabled = Number.isFinite(idleSilenceSeconds) && idleSilenceSeconds === 0;
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
    this.transcribeThreads =
      Number.isInteger(transcribeThreads) && transcribeThreads > 0
        ? transcribeThreads
        : null;
    this.noSpeechThreshold =
      Number.isFinite(noSpeechThreshold) && noSpeechThreshold >= 0
        ? noSpeechThreshold
        : null;
    this.entropyThreshold =
      Number.isFinite(entropyThreshold) && entropyThreshold >= 0
        ? entropyThreshold
        : null;
    this.transcribeLanguage =
      transcribeLanguage != null && String(transcribeLanguage).trim() !== ''
        ? String(transcribeLanguage).trim()
        : null;
    // T-5: peak gating threshold. Chunks whose sidecar peak < this are
    // marked 'skipped' with a stub .md and never enter the transcription
    // queue. Default 0.02 (~-34 dBFS) is above typical room hum/HVAC but
    // well below conversational speech. Set to 0 to disable the gate.
    this.transcribeMinPeak = Number.isFinite(transcribeMinPeak) && transcribeMinPeak >= 0
      ? transcribeMinPeak
      : 0.02;
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
    // Whisper-server promise: resolves to a live WhisperServer instance, or null
    // if the binary wasn't found / failed to start. Only started when transcription
    // is enabled and no custom transcribeFn was injected (injected fns are for tests).
    this._whisperServerPromise = null;
    if (this.transcribe) {
      // Effective transcribe function: try the persistent server first (model
      // already loaded), fall back to spawning a fresh whisper-cli if the server
      // isn't available or hasn't started yet.
      const effectiveTranscribeFn = transcribeFn || ((opts) => this._serverAwareTranscribe(opts));
      if (!transcribeFn && useWhisperServer !== false) {
        // Fire-and-forget server startup. Errors are caught and reported as a
        // warn so recording is never blocked by a server startup failure.
        this._whisperServerPromise = this._startWhisperServerSilently();
      }
      const runFn = (job) => runWithMarkdown(job, {
        transcribeFn: effectiveTranscribeFn,
        maxRetries: this.transcribeRetries,
      });
      const logger = transcribeLogger || {
        onSuccess: (job, result) => {
          // Announce the session HTML (single file the user follows live)
          // when available; fall back to the per-chunk .md, then the .txt.
          const announcePath = (result && result.htmlPath)
            || (result && result.mdPath)
            || (result && result.txtPath);
          if (announcePath) {
            const rel = path.relative(process.cwd(), announcePath);
            console.log(`[transcribed] ${rel}`);
          }
        },
        onFailure: (job, error) => {
          const rel = path.relative(process.cwd(), job.wav);
          const stubNote = (error && (error.mdPath || error.htmlPath)) ? ' (stub written)' : '';
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
    if (this.transcribe) {
      trace('recorder', 'Transcription queue enabled', {
        model: this.transcribeModel,
        language: this.transcribeLanguage,
        transcribeMinPeak: this.transcribeMinPeak,
        transcribeQueueMaxWarn: this.transcribeQueueMax,
        transcribeRetries: this.transcribeRetries,
      });
    } else {
      trace('recorder', 'Transcription disabled (pass --transcribe on record or idle to enable)');
    }
  }

  // Probe for whisper-server, start it if found, log the outcome.
  // Always resolves (never rejects) — errors are surfaced as console.warn
  // and the session continues with per-chunk CLI fallback.
  _startWhisperServerSilently() {
    const { WhisperServer } = require('./whisperServer');
    const os = require('os');
    const binary = WhisperServer.probe();
    if (!binary) {
      trace('whisperServer', 'binary not found on PATH; using per-chunk whisper-cli');
      return Promise.resolve(null);
    }
    const server = new WhisperServer();
    const threads = this.transcribeThreads || Math.min(os.cpus().length, 8);
    return server.start({ binary, model: this.transcribeModel, threads })
      .then(() => {
        console.log(`[whisper-server] ready — model cached, per-chunk load overhead eliminated`);
        return server;
      })
      .catch((err) => {
        console.warn(`[whisper-server] startup failed (${err.message}); falling back to per-chunk CLI`);
        return null;
      });
  }

  // Transcription function used when a persistent whisper-server is available.
  // Falls back to the standard whisper-cli spawn if the server is not ready.
  async _serverAwareTranscribe({ wav, model, language, threads, noSpeechThreshold, entropyThreshold }) {
    if (this._whisperServerPromise) {
      const server = await this._whisperServerPromise;
      if (server && server.ready) {
        trace('whisperServer', 'using server for chunk', { wav: path.basename(wav) });
        return server.transcribeToFile(wav, { language, noSpeechThreshold, entropyThreshold });
      }
    }
    trace('whisperServer', 'falling back to CLI for chunk', { wav: path.basename(wav) });
    return transcribeFile({ wav, model, language, threads, noSpeechThreshold, entropyThreshold });
  }

  // Wait for any in-flight or queued transcriptions to settle. Safe to call
  // when transcription is off (returns a resolved promise). The CLI shutdown
  // path awaits this before process.exit so we don't kill whisper-cli mid-job.
  drainTranscriptions() {
    if (!this.transcribeQueue) {
      trace('transcribe', 'drainTranscriptions: no queue (transcription not enabled on this recorder)');
      return Promise.resolve();
    }
    trace('transcribe', 'drainTranscriptions: waiting', { pending: this.transcribeQueue.length });
    return this.transcribeQueue.drain().then(async () => {
      trace('transcribe', 'drainTranscriptions: queue empty');
      if (this._whisperServerPromise) {
        const server = await this._whisperServerPromise.catch(() => null);
        if (server) {
          server.stop();
          trace('whisperServer', 'stopped after drain');
        }
      }
    });
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
    // Async IIFE inside 'close': keeps the event loop free during the
    // stat + WAV-header-patch + sidecar-write sequence (Sprint M2).
    fileStream.once('close', () => {
      (async () => {
      const closedAt = new Date();
      trace('finalize', 'WriteStream closed', { file: path.relative(process.cwd(), filePath), hasSidecar: !!(sidecar && sidecar.peakAcc && sidecar.format) });
      let size = -1;
      try {
        size = (await fs.promises.stat(filePath)).size;
      } catch (err) {
        trace('finalize', 'stat failed after close; skipping transcription path', { filePath, err: err.message });
        return;
      }
      if (size === 0) {
        console.warn(`Skipping empty chunk (sox crash?): ${path.basename(filePath)}`);
        trace('finalize', 'zero-byte WAV removed; no transcription', { filePath });
        try { await fs.promises.unlink(filePath); } catch (_) { /* leave it */ }
        return;
      }
      let finalizeResult = null;
      if (/\.wav$/i.test(filePath)) {
        try {
          finalizeResult = await finalizeWavHeaderAsync(filePath);
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
          await fs.promises.writeFile(
            sidecarPathFor(filePath),
            `${JSON.stringify(sidecarPayload, null, 2)}\n`,
          );
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
      // `transcribeMinPeak` (default 0.02), skip the queue entirely and
      // write a `_skipped: ..._` .md stub immediately. Saves whisper.cpp
      // CPU on dead-air chunks and gives the user explicit visibility into
      // why a particular chunk's .txt is missing.
      if (this.transcribeQueue) {
        const peak = sidecarPayload != null ? sidecarPayload.peak : null;
        const shouldSkip = this.transcribeMinPeak > 0
          && peak != null
          && Number.isFinite(peak)
          && peak < this.transcribeMinPeak;
        trace('finalize', 'transcription decision', {
          file: path.basename(filePath),
          bytes: size,
          peak,
          transcribeMinPeak: this.transcribeMinPeak,
          shouldSkipPeakGate: shouldSkip,
        });
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
          // Skipped chunks also flow into the session HTML so the reader
          // sees an explicit "[skipped] ..." entry rather than a silent gap.
          try {
            appendChunkToSessionHtml({
              wav: filePath,
              sidecar: sidecarPayload != null ? sidecarPayload : { wav: path.basename(filePath) },
              transcribeStatus: 'skipped',
              transcribeError: reason,
            });
          } catch (htmlErr) {
            console.warn(`[session html failed] ${path.relative(process.cwd(), filePath)}: ${htmlErr.message}`);
          }
          console.log(
            `[transcribe skipped] ${path.relative(process.cwd(), filePath)} (${reason})`,
          );
        } else {
          trace('finalize', 'enqueue transcription job', {
            wav: path.relative(process.cwd(), filePath),
            model: this.transcribeModel,
            language: this.transcribeLanguage,
          });
          this.transcribeQueue.enqueue({
            wav: filePath,
            model: this.transcribeModel,
            language: this.transcribeLanguage,
            threads: this.transcribeThreads,
            noSpeechThreshold: this.noSpeechThreshold,
            entropyThreshold: this.entropyThreshold,
          });
        }
      } else {
        trace('finalize', 'no transcription queue (transcribe off or not constructed)', {
          file: path.basename(filePath),
        });
      }
      })().catch((err) => {
        // Unhandled async errors in the finalize IIFE: log but never crash.
        console.warn(`[finalize error] ${path.basename(filePath)}: ${err.message}`);
        trace('finalize', 'async IIFE error', { filePath, err: err.message });
      });
    });
  }

  // Attach a throttled peak emitter to a recording stream so callers can drive
  // a live meter without polling. Emits (peak, db) at ~80 ms intervals.
  // Safe to call when peakHandler is null — becomes a no-op.
  _wirePeakEmitter(stream) {
    if (!this.peakHandler) return;
    const handler = this.peakHandler;
    let windowPeak = 0;
    let lastEmit = 0;
    stream.on('data', (chunk) => {
      const p = peak16LE(chunk);
      if (p > windowPeak) windowPeak = p;
      const now = Date.now();
      if (now - lastEmit >= 80) {
        handler(windowPeak, toDb(windowPeak));
        windowPeak = 0;
        lastEmit = now;
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
    this._wirePeakEmitter(stream);
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
    this._wirePeakEmitter(stream);
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
        // When silence detection is disabled, sox records continuously and
        // we rely entirely on --max-chunk-seconds to rotate. recorderPatch
        // omits the silence args from sox when endOnSilence is false.
        endOnSilence: !this.idleSilenceDisabled,
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
      this._wirePeakEmitter(stream);
      stream.on('error', (err) => {
        // If stop() cleared this.recording, the error came from an intentional
        // kill -- stay quiet and let the shutdown path do its thing.
        clearMaxChunkTimer();
        if (!this.recording) return;
        // sox occasionally crashes with exit code null on Windows (waveaudio
        // handle exhaustion after several long chunks). Treat it as a finished
        // chunk and restart automatically rather than aborting the session.
        console.warn(`Idle-listen stream error (restarting): ${err.message || err}`);
        this.recording = null;
        if (this.fileStream) {
          try { this.fileStream.end(); } catch (_) { /* already closed */ }
          this.fileStream = null;
          this.fileStreamPath = null;
        }
        if (this.idle) {
          setTimeout(recordChunk, 500);
        }
      });

      stream.on('end', () => {
        // Either sox detected silence and exited cleanly, or stop()/max-chunk
        // killed it. Either way, close the current chunk; only schedule the
        // next one if we're still in idle mode (i.e. stop() didn't run).
        clearMaxChunkTimer();
        console.log(`Finished chunk: ${path.basename(chunkPath)}`);
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

      if (this.chunkStartedHandler) this.chunkStartedHandler(chunkPath);
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