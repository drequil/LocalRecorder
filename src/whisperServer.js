// Persistent whisper-server manager.
//
// Motivation: every per-chunk `whisper-cli` spawn reloads the model from disk
// (~0.5-5 s depending on model size and filesystem cache). For large-v3 on a
// GPU this overhead dominates short chunks. `whisper-server` is a separate
// whisper.cpp binary that keeps the model resident (in RAM/VRAM) and handles
// transcription requests over a local HTTP API, reducing per-chunk overhead to
// a network round-trip (<100 ms).
//
// Usage contract:
//   const ws = new WhisperServer();
//   const binary = WhisperServer.probe();         // null if not on PATH
//   await ws.start({ binary, model, threads });   // blocks until port opens
//   const { text, txtPath } = await ws.transcribeToFile(wav, opts);
//   ws.stop();                                    // SIGTERM the process
//
// The AudioRecorder constructor calls _startWhisperServerSilently() which
// fires this in the background. By the time the first 30-second chunk
// finishes, the model is already loaded.

'use strict';

const { spawnSync, spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { trace } = require('./trace');

const WHISPER_SERVER_CANDIDATES = Object.freeze(['whisper-server', 'whisper-server.exe']);

// How long to wait for whisper-server to start accepting connections.
// large-v3 mmap-loading on a cold NVMe can take 3–8 s; 30 s gives ample room.
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_POLL_INTERVAL_MS = 250;

// Per-request inference timeout: 5 minutes. For a 10-minute chunk with
// large-v3, real-time factor is ~0.3 so ~3 min. Keep well above worst case.
const INFERENCE_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

// Pure: shape the argv we hand to whisper-server's spawn. Extracted so tests
// can pin the exact flag order without spawning. The contract matches
// buildWhisperArgs() in src/transcribe.js for GPU semantics so callers can
// reason about the persistent-server and per-chunk-CLI paths interchangeably.
function buildServerArgs({ model, threads, port, gpu = null, gpuLayers = null }) {
  const args = ['-m', model, '-t', String(threads)];
  if (gpu === false) {
    args.push('--no-gpu');
  } else if (gpu === true && Number.isInteger(gpuLayers) && gpuLayers > 0) {
    args.push('-ngl', String(gpuLayers));
  }
  args.push('--port', String(port), '--host', '127.0.0.1');
  return args;
}

// GPU-4: prefer `vendor/whisper-cuda/` over PATH so an `npm run gpu:install`
// run wins the next probe without the user touching PATH. Falls back to the
// candidate name (PATH-resolved via spawnSync) when nothing's in vendor.
function probeServerBinary(candidates) {
  const { vendorBinaryPath } = require('../tools/check-transcribe-deps');
  // Build a flat candidate list of {name, spawnTarget} to try in order.
  // Vendor candidates come first so they win when present.
  const ordered = [];
  for (const name of candidates) {
    const abs = vendorBinaryPath(name);
    if (abs) ordered.push({ name, spawnTarget: abs });
  }
  for (const name of candidates) ordered.push({ name, spawnTarget: name });
  for (const { spawnTarget } of ordered) {
    try {
      const r = spawnSync(spawnTarget, ['--help'], {
        encoding: 'utf8',
        timeout: 2_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      // spawnSync sets r.error on ENOENT / EACCES; absence means binary ran.
      if (!r.error) return spawnTarget;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForPort(port, timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => { sock.destroy(); resolve(false); });
    });
    if (ready) return true;
    await new Promise((r) => setTimeout(r, SERVER_POLL_INTERVAL_MS));
  }
  return false;
}

// Build a multipart/form-data body containing the WAV file plus text fields.
function buildMultipart(wavPath, fields) {
  const boundary = `LR-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const parts = [];

  const fileContent = fs.readFileSync(wavPath);
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${path.basename(wavPath)}"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`,
  ));
  parts.push(fileContent);
  parts.push(Buffer.from('\r\n'));

  for (const [name, value] of Object.entries(fields)) {
    if (value != null) {
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${String(value)}\r\n`,
      ));
    }
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

function httpPost(port, urlPath, { boundary, body }, timeoutMs = INFERENCE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            return reject(new Error(
              `whisper-server HTTP ${res.statusCode}: ${raw.slice(0, 300)}`,
            ));
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`whisper-server: invalid JSON: ${raw.slice(0, 200)}`));
          }
        });
      },
    );

    const timer = setTimeout(
      () => req.destroy(new Error(`whisper-server: request timed out (${timeoutMs}ms)`)),
      timeoutMs,
    );
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// WhisperServer
// ---------------------------------------------------------------------------

class WhisperServer {
  constructor() {
    this.proc = null;
    this.port = null;
    this.ready = false;
  }

  // Returns the first whisper-server binary name found on PATH, or null.
  static probe(candidates = WHISPER_SERVER_CANDIDATES) {
    return probeServerBinary(candidates);
  }

  // Spawn whisper-server with the given model, wait until the HTTP port
  // accepts connections, then set this.ready = true.
  //
  // GPU semantics mirror buildWhisperArgs() in src/transcribe.js so the
  // persistent-server path and the per-chunk CLI path stay in lockstep:
  //   gpu === false      → --no-gpu (force CPU)
  //   gpu === true       → -ngl <N> when gpuLayers is a positive int; else omit
  //   gpu == null        → omit; let whisper.cpp's build default decide
  //
  // spawnFn / waitForPortFn are injectable for tests so the suite can pin the
  // exact argv without actually starting a server.
  async start({ binary, model, threads = 4, gpu = null, gpuLayers = null, spawnFn = spawn, waitForPortFn = waitForPort }) {
    if (this.ready) throw new Error('WhisperServer: already started');

    this.port = await findFreePort();

    const args = buildServerArgs({ model, threads, port: this.port, gpu, gpuLayers });

    // Record the configured GPU intent so consumers (UI, sidecar, bench) can
    // report the choice without re-parsing argv.
    this.gpu = gpu === true ? true : (gpu === false ? false : null);
    this.gpuLayers = gpu === true && Number.isInteger(gpuLayers) && gpuLayers > 0 ? gpuLayers : null;

    trace('whisperServer', 'spawning', {
      binary,
      model: path.basename(model),
      threads,
      gpu: this.gpu,
      gpuLayers: this.gpuLayers,
      port: this.port,
    });

    this.proc = spawnFn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.stdout.on('data', (d) => trace('whisperServer', 'stdout', { line: d.toString().trimEnd() }));
    this.proc.stderr.on('data', (d) => trace('whisperServer', 'stderr', { line: d.toString().trimEnd() }));
    this.proc.on('error', (err) => trace('whisperServer', 'proc-error', { err: err.message }));
    this.proc.on('exit', (code) => {
      trace('whisperServer', 'proc-exit', { code });
      this.ready = false;
    });

    const ok = await waitForPortFn(this.port, SERVER_READY_TIMEOUT_MS);
    if (!ok) {
      this.stop();
      throw new Error(
        `whisper-server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms` +
        ` (model: ${path.basename(model)})`,
      );
    }

    this.ready = true;
    trace('whisperServer', 'ready', { port: this.port, model: path.basename(model) });
  }

  // POST the WAV file to /inference, return { text }.
  // Passes no_speech_thold / entropy_thold if the server supports them
  // (whisper.cpp >= v1.6.0); they are silently ignored by older builds.
  async transcribe(wavPath, {
    language = null,
    noSpeechThreshold = null,
    entropyThreshold = null,
    temperature = 0.0,
  } = {}) {
    if (!this.ready) throw new Error('WhisperServer: not started or already stopped');

    const fields = {
      temperature: String(temperature ?? 0.0),
      response_format: 'json',
    };
    if (language) fields.language = language;
    if (noSpeechThreshold != null && Number.isFinite(noSpeechThreshold)) {
      fields.no_speech_thold = String(noSpeechThreshold);
    }
    if (entropyThreshold != null && Number.isFinite(entropyThreshold)) {
      fields.entropy_thold = String(entropyThreshold);
    }

    const multipart = buildMultipart(wavPath, fields);
    const json = await httpPost(this.port, '/inference', multipart);
    return { text: (json.text || '').trim() };
  }

  // Convenience wrapper: transcribe and write the canonical .txt sibling,
  // returning { text, txtPath } — same shape as transcribeFile() in transcribe.js.
  async transcribeToFile(wavPath, opts = {}) {
    const { text } = await this.transcribe(wavPath, opts);
    const dir = path.dirname(wavPath);
    const stem = path.basename(wavPath, path.extname(wavPath));
    const txtPath = path.join(dir, `${stem}.txt`);
    fs.writeFileSync(txtPath, text.length > 0 ? `${text}\n` : '');
    return { text, txtPath };
  }

  // Send SIGTERM to the server process. Safe to call multiple times.
  stop() {
    if (this.proc && !this.proc.killed) {
      trace('whisperServer', 'stopping', { port: this.port });
      this.proc.kill('SIGTERM');
    }
    this.ready = false;
  }
}

module.exports = {
  WhisperServer,
  WHISPER_SERVER_CANDIDATES,
  buildServerArgs,
  // Exported for testing:
  _internal: { probeServerBinary, buildMultipart, waitForPort, buildServerArgs },
};
