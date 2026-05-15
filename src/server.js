const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const AudioRecorder = require('./audioRecorder');
const { enumerateDevices } = require('./audioDevices');
const { effectiveRecordingsRoot, loadUserConfig, ensureDefaultUserConfigIfMissing } = require('./userConfig');
const { resolveRecordPath, resolveIdleDirectory } = require('./recordingPaths');
const { DEFAULT_MODEL_PATH, resolveBinary } = require('./transcribe');
const { resolveBestAvailableModel } = require('./whisperModelPreset');
const { WhisperServer } = require('./whisperServer');
const { detectGpu } = require('../tools/check-gpu');
const {
  resolveTranscribeThreads,
  resolveNoSpeechThreshold,
  resolveEntropyThreshold,
} = require('./index');

const PORT = Number(process.env.PORT) || 4444;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'ui')));

// ---- Server info (model + binary, resolved once on first request) ---------

let _serverInfo = null;

function getServerInfo() {
  if (_serverInfo) return _serverInfo;
  const userCfg = loadUserConfig();
  const modelPath = userCfg.transcribeModel || resolveBestAvailableModel(process.cwd());
  // Strip the ggml- prefix and .bin suffix for a readable label (e.g. "large-v3", "base.en").
  const modelName = path.basename(modelPath).replace(/^ggml-/, '').replace(/\.bin$/i, '');
  const binary = resolveBinary() || null;
  const serverBinary = WhisperServer.probe() || null;
  // GPU-3: include the cached GPU probe so the UI can render a "GPU: RTX..."
  // badge in the sidebar. detectGpu() is memoised at module level inside
  // tools/check-gpu.js so this call is O(1) after the first hit.
  const gpuInfo = detectGpu();
  const gpu = {
    available: !!gpuInfo.effective,
    deviceName: gpuInfo.gpu && gpuInfo.gpu.primary ? gpuInfo.gpu.primary.name : null,
    vramMb: gpuInfo.gpu && gpuInfo.gpu.primary ? gpuInfo.gpu.primary.vramMb : null,
    driver: gpuInfo.gpu && gpuInfo.gpu.primary ? gpuInfo.gpu.primary.driver : null,
    cudaCapable: !!(gpuInfo.binary && gpuInfo.binary.cudaCapable),
    // Reason string for the "why isn't GPU on?" tooltip. Empty when effective.
    reason: gpuInfo.effective
      ? null
      : (gpuInfo.gpu && !gpuInfo.gpu.available
        ? `no GPU detected (${gpuInfo.gpu.reason})`
        : (gpuInfo.binary && !gpuInfo.binary.cudaCapable
          ? `whisper.cpp build does not expose GPU flags (${gpuInfo.binary.reason || 'unknown'})`
          : 'unknown')),
  };
  _serverInfo = { modelPath, modelName, binary, serverBinary, gpu };
  return _serverInfo;
}

// ---- State ----------------------------------------------------------------

const state = {
  mode: null,           // 'record' | 'chunk' | 'listen' | null
  recorder: null,
  startedAt: null,
  chunkCount: 0,
  sessionDir: null,
  transcribeEnabled: false,
  queueDepth: 0,
  chunks: [],           // { name, wavPath, status, transcript? }
};

// ---- WebSocket helpers ----------------------------------------------------

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(data);
  }
}

function broadcastStatus() {
  broadcast({
    type: 'status',
    mode: state.mode,
    elapsed: state.startedAt ? Date.now() - state.startedAt : 0,
    chunkCount: state.chunkCount,
    sessionDir: state.sessionDir,
    transcribeEnabled: state.transcribeEnabled,
    queueDepth: state.queueDepth,
  });
}

let statusInterval = null;

function startStatusBroadcast() {
  if (statusInterval) return;
  statusInterval = setInterval(broadcastStatus, 1000);
}

function stopStatusBroadcast() {
  if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
}

// ---- Peak callback --------------------------------------------------------

function onPeak(peak, db) {
  broadcast({ type: 'peak', value: peak, db });
}

// ---- Transcribe logger factory --------------------------------------------

function makeTranscribeLogger() {
  return {
    onSuccess(job, result) {
      state.queueDepth = Math.max(0, state.queueDepth - 1);
      const name = path.basename(job.wav);
      const entry = state.chunks.find((c) => c.wavPath === job.wav);
      if (entry) { entry.status = 'ok'; entry.transcript = result ? result.text : ''; }
      broadcast({
        type: 'chunk_complete',
        name,
        wavPath: job.wav,
        status: 'ok',
        transcript: result ? result.text : '',
        queueDepth: state.queueDepth,
      });
    },
    onFailure(job, error) {
      state.queueDepth = Math.max(0, state.queueDepth - 1);
      const name = path.basename(job.wav);
      const entry = state.chunks.find((c) => c.wavPath === job.wav);
      if (entry) { entry.status = 'failed'; }
      broadcast({
        type: 'chunk_complete',
        name,
        wavPath: job.wav,
        status: 'failed',
        error: error.message,
        queueDepth: state.queueDepth,
      });
    },
    onOverflow(depth) {
      state.queueDepth = depth;
      broadcast({ type: 'queue_overflow', depth });
    },
  };
}

// ---- Session browser helpers ----------------------------------------------

function getRecordingsRoot() {
  const pick = effectiveRecordingsRoot(null);
  return pick.root || path.resolve(process.cwd(), 'recordings');
}

function listSessions() {
  const root = getRecordingsRoot();
  if (!fs.existsSync(root)) return [];

  const sessions = [];
  let dateDirs;
  try { dateDirs = fs.readdirSync(root); } catch { return []; }

  for (const date of dateDirs.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()) {
    const dateDir = path.join(root, date);
    let entries;
    try { entries = fs.readdirSync(dateDir); } catch { continue; }

    const subDirs = entries.filter((e) => {
      try { return fs.statSync(path.join(dateDir, e)).isDirectory(); } catch { return false; }
    });

    for (const sub of subDirs) {
      sessions.push({ date, name: sub, sessionDir: path.join(dateDir, sub) });
    }

    const wavs = entries.filter((e) => e.endsWith('.wav') || e.endsWith('.json'));
    if (wavs.length > 0 && subDirs.length === 0) {
      sessions.push({ date, name: null, sessionDir: dateDir });
    }
  }
  return sessions;
}

function getSessionDetail(date, name) {
  const root = getRecordingsRoot();
  const sessionDir = name ? path.join(root, date, name) : path.join(root, date);
  if (!fs.existsSync(sessionDir)) return null;

  let files;
  try { files = fs.readdirSync(sessionDir); } catch { return null; }

  const wavs = files.filter((f) => f.endsWith('.wav')).sort();
  const chunks = wavs.map((wav) => {
    const wavPath = path.join(sessionDir, wav);
    const jsonPath = wavPath.replace(/\.wav$/i, '.json');
    const txtPath = wavPath.replace(/\.wav$/i, '.txt');

    let sidecar = null;
    try { sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { /* none */ }

    let transcript = null;
    try { transcript = fs.readFileSync(txtPath, 'utf8').trim() || null; } catch { /* none */ }

    return { wav, wavPath, sidecar, transcript };
  });

  const htmlPath = path.join(sessionDir, 'transcript.html');
  return {
    date,
    name,
    sessionDir,
    chunks,
    htmlPath: fs.existsSync(htmlPath) ? htmlPath : null,
  };
}

// ---- API routes -----------------------------------------------------------

app.get('/api/info', (_req, res) => {
  res.json(getServerInfo());
});

const { version: SERVER_VERSION } = require('../package.json');

app.get('/api/config', (_req, res) => {
  ensureDefaultUserConfigIfMissing();
  const userCfg = loadUserConfig();
  const root = getRecordingsRoot();
  // GPU-3: also surface the GPU probe so the sidebar can render a status
  // badge alongside model and version. Same cached probe used by /api/info.
  const { gpu } = getServerInfo();
  res.json({ recordingsRoot: root, configPath: userCfg.configPath, version: SERVER_VERSION, gpu });
});

app.get('/api/status', (_req, res) => {
  res.json({
    mode: state.mode,
    elapsed: state.startedAt ? Date.now() - state.startedAt : 0,
    chunkCount: state.chunkCount,
    sessionDir: state.sessionDir,
    transcribeEnabled: state.transcribeEnabled,
    queueDepth: state.queueDepth,
    chunks: state.chunks,
  });
});

app.get('/api/devices', async (_req, res) => {
  try {
    const { devices } = await enumerateDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions', (_req, res) => {
  try { res.json(listSessions()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sessions/:date', (req, res) => {
  try {
    const detail = getSessionDetail(req.params.date, req.query.name || null);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve raw transcript file (txt or html) for inline viewing.
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return res.status(404).send('Not found');
  res.sendFile(abs);
});

app.post('/api/start', async (req, res) => {
  if (state.mode) return res.status(409).json({ error: 'Already recording' });

  const {
    mode = 'chunk',
    device,
    name,
    root: rootOverride,
    transcribe: transcribeOverride,
    transcribeSpeakerLabels: transcribeSpeakerLabelsBody,
    maxChunkSeconds,
    silenceSeconds,
  } = req.body || {};

  ensureDefaultUserConfigIfMissing();
  const userCfg = loadUserConfig();
  const rootPick = effectiveRecordingsRoot(rootOverride || null);

  let sessionDir;
  let recordTarget;

  if (mode === 'record') {
    const resolved = resolveRecordPath({ root: rootPick.root, name });
    recordTarget = resolved.filePath;
    sessionDir = resolved.sessionDir;
  } else {
    const resolved = resolveIdleDirectory({ root: rootPick.root, name });
    sessionDir = resolved.sessionDir;
  }

  try { fs.mkdirSync(sessionDir, { recursive: true }); } catch (err) {
    return res.status(500).json({ error: `Cannot create session dir: ${err.message}` });
  }

  const model = userCfg.transcribeModel || DEFAULT_MODEL_PATH;
  const modelAbs = path.isAbsolute(model) ? model : path.resolve(process.cwd(), model);
  const modelExists = fs.existsSync(modelAbs);

  const doTranscribe = transcribeOverride === true
    || (transcribeOverride !== false && modelExists);

  const transcribeSpeakerLabels =
    doTranscribe
    && mode !== 'listen'
    && transcribeSpeakerLabelsBody !== false;

  const recorder = new AudioRecorder({
    device: device || undefined,
    transcribe: doTranscribe && mode !== 'listen',
    transcribeSpeakerLabels,
    transcribeModel: model,
    transcribeLanguage: userCfg.transcribeLanguage || null,
    transcribeThreads: resolveTranscribeThreads(null),
    noSpeechThreshold: resolveNoSpeechThreshold(null),
    entropyThreshold: resolveEntropyThreshold(null),
    maxChunkSeconds: maxChunkSeconds != null ? Number(maxChunkSeconds) : 30,
    idleSilenceSeconds: silenceSeconds != null ? Number(silenceSeconds) : 0,
    peakHandler: onPeak,
    chunkStartedHandler: (wavPath) => {
      state.chunkCount += 1;
      if (doTranscribe) state.queueDepth += 1;
      const entry = { name: path.basename(wavPath), wavPath, status: 'pending' };
      state.chunks.push(entry);
      broadcast({ type: 'chunk_started', name: entry.name, wavPath, chunkCount: state.chunkCount });
    },
    transcribeLogger: makeTranscribeLogger(),
  });

  state.recorder = recorder;
  state.mode = mode;
  state.startedAt = Date.now();
  state.chunkCount = 0;
  state.sessionDir = sessionDir;
  state.transcribeEnabled = doTranscribe && mode !== 'listen';
  state.queueDepth = 0;
  state.chunks = [];

  // Broadcast 'started' BEFORE calling the recorder so that clients clear
  // their transcript feed before the very first chunk_started event arrives.
  // Both messages travel over the same WebSocket connection and are delivered
  // in order; starting the recorder synchronously after the broadcast ensures
  // chunk_started always follows started, never precedes it.
  startStatusBroadcast();
  broadcast({ type: 'started', mode, sessionDir, transcribeEnabled: state.transcribeEnabled });

  try {
    if (mode === 'record') {
      recorder.start(recordTarget);
      state.chunkCount = 1;
    } else if (mode === 'chunk') {
      recorder.idleListen(sessionDir);
    } else if (mode === 'listen') {
      recorder.listen(() => {});
    } else {
      state.mode = null;
      return res.status(400).json({ error: `Unknown mode: ${mode}` });
    }
  } catch (err) {
    state.mode = null;
    state.recorder = null;
    return res.status(500).json({ error: err.message });
  }

  res.json({ ok: true, mode, sessionDir, transcribeEnabled: state.transcribeEnabled });
});

app.post('/api/stop', (req, res) => {
  if (!state.mode) return res.status(409).json({ error: 'Not recording' });

  const recorder = state.recorder;
  const sessionDir = state.sessionDir;
  const queueDepth = state.queueDepth;

  try { recorder.stop(); } catch { /* already stopped */ }

  state.mode = null;
  state.recorder = null;
  state.startedAt = null;
  stopStatusBroadcast();

  broadcast({ type: 'stopping', sessionDir, queueDepth });
  res.json({ ok: true, sessionDir, draining: queueDepth > 0 });

  // Drain in background then announce fully stopped.
  setTimeout(async () => {
    try { await recorder.drainTranscriptions(); } catch { /* drain never rejects */ }
    state.chunkCount = 0;
    state.queueDepth = 0;
    state.sessionDir = null;
    state.chunks = [];
    broadcast({ type: 'stopped', sessionDir });
  }, 250);
});

// ---- WebSocket connection -------------------------------------------------

wss.on('connection', (ws) => {
  // Full snapshot so a browser connecting mid-session can reconstruct the
  // transcript feed in correct start order without replaying missed events.
  ws.send(JSON.stringify({
    type: 'sync',
    mode: state.mode,
    elapsed: state.startedAt ? Date.now() - state.startedAt : 0,
    chunkCount: state.chunkCount,
    sessionDir: state.sessionDir,
    transcribeEnabled: state.transcribeEnabled,
    queueDepth: state.queueDepth,
    chunks: state.chunks.slice(),
  }));
  // Send model/binary info immediately after the status snapshot.
  ws.send(JSON.stringify({ type: 'server_info', ...getServerInfo() }));
});

// ---- Start ----------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`LocalRecorder UI  →  http://localhost:${PORT}`);
  const info = getServerInfo();
  const binaryLabel = info.serverBinary
    ? `whisper-server (${info.serverBinary})`
    : info.binary
    ? `whisper-cli    (${info.binary})`
    : 'no whisper binary found on PATH';
  console.log(`Whisper model     →  ${info.modelName}  (${info.modelPath})`);
  console.log(`Whisper binary    →  ${binaryLabel}`);
});
