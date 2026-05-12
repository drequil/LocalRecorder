const fs = require('fs');
const path = require('path');
const AudioRecorder = require('./audioRecorder');
const { enumerateDevices } = require('./audioDevices');
const { peak16LE, toDb, renderBar } = require('./audioLevels');
const { resolveRecordPath, resolveIdleDirectory } = require('./recordingPaths');
const {
  DEFAULT_MODEL_PATH,
  transcribeFile,
  resolveBinary,
} = require('./transcribe');
const { probeBinary, parseWhisperHelp } = require('../tools/check-transcribe-deps');

// Minimal subcommand flag parser. flagSpec maps `--flag-name` to a descriptor
// {type, as}. Supports `--flag value` and `--flag=value` shapes; rejects unknown
// flags and missing values. Returns { flags, positional } or { error }.
const COERCERS = {
  positiveNumber(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: `must be a positive number, got ${JSON.stringify(raw)}` };
    }
    return { value: n };
  },
  nonNegativeNumber(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { error: `must be a non-negative number, got ${JSON.stringify(raw)}` };
    }
    return { value: n };
  },
  percent(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { error: `must be a number 0..100, got ${JSON.stringify(raw)}` };
    }
    return { value: n };
  },
  string(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { error: 'must be a non-empty string' };
    }
    return { value: raw };
  },
};

function parseSubcommandArgs(args, flagSpec) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    let inlineValue = null;
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      inlineValue = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a.startsWith('--')) {
      const spec = flagSpec[a];
      if (!spec) return { error: `unknown flag: ${a}` };
      // Boolean presence flag (no value, e.g. --json). Reject `--flag=value` shorthand
      // so we don't silently accept `--json=foo`; bare `--flag` is the only valid form.
      if (spec.type === 'flag') {
        if (inlineValue !== null) {
          return { error: `${a} does not take a value (got ${JSON.stringify(inlineValue)})` };
        }
        flags[spec.as] = true;
        continue;
      }
      let raw = inlineValue;
      if (raw === null) {
        raw = args[i + 1];
        if (raw === undefined) return { error: `${a} requires a value` };
        i += 1;
      }
      const coerce = COERCERS[spec.type];
      if (!coerce) return { error: `${a}: internal: unknown coercion type ${spec.type}` };
      const parsed = coerce(raw);
      if (parsed.error) return { error: `${a} ${parsed.error}` };
      flags[spec.as] = parsed.value;
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

const RECORD_FLAGS = {
  '--duration': { type: 'positiveNumber', as: 'durationSeconds' },
  '--device': { type: 'string', as: 'device' },
  '--name': { type: 'string', as: 'name' },
  '--root': { type: 'string', as: 'root' },
};

const IDLE_FLAGS = {
  '--threshold': { type: 'percent', as: 'idleThreshold' },
  '--silence': { type: 'positiveNumber', as: 'idleSilenceSeconds' },
  '--device': { type: 'string', as: 'device' },
  '--max-chunk-seconds': { type: 'positiveNumber', as: 'maxChunkSeconds' },
  '--duration': { type: 'positiveNumber', as: 'durationSeconds' },
  '--name': { type: 'string', as: 'name' },
  '--root': { type: 'string', as: 'root' },
  '--transcribe': { type: 'flag', as: 'transcribe' },
  '--model': { type: 'string', as: 'transcribeModel' },
};

const LISTEN_FLAGS = {
  '--device': { type: 'string', as: 'device' },
};

const TRANSCRIBE_FLAGS = {
  '--model': { type: 'string', as: 'model' },
  '--json': { type: 'flag', as: 'json' },
};

function printHelp() {
  console.log('LocalRecorder v0.1.0');
  console.log('');
  console.log('Subcommands:');
  console.log('  devices                                                List audio input devices visible to sox');
  console.log('  listen   [--device <id>]                               Live peak-level meter (no file written)');
  console.log('  record   [<out.wav>] [--name <label>] [--root <dir>]   Record one WAV');
  console.log('           [--duration N] [--device <id>]');
  console.log('  idle     [<directory>] [--name <label>] [--root <dir>] Per-silence WAV chunks + JSON sidecars');
  console.log('           [--threshold P] [--silence N] [--device <id>]');
  console.log('           [--duration N] [--max-chunk-seconds N]');
  console.log('           [--transcribe] [--model <path>]');
  console.log('  transcribe <file.wav> [--model <path>] [--json]        Transcribe one WAV via whisper.cpp CLI');
  console.log('  help                                                   Show this help');
  console.log('');
  console.log('Output layout:');
  console.log('  --name <label>          recordings/<label>/<label>-<ts>.wav (record)');
  console.log('                          recordings/<label>/chunk-<ts>-<ms>.wav (idle)');
  console.log('  no name                 recordings/<YYYY-MM-DD>/recording-<ts>.wav (record)');
  console.log('                          recordings/<YYYY-MM-DD>/chunk-<ts>-<ms>.wav (idle)');
  console.log('  explicit positional     written literally; --name / --root ignored');
  console.log('  --root <dir>            override the recordings root (default ./recordings)');
  console.log('');
  console.log('Flag notes:');
  console.log('  --duration N            Stop after N seconds (record + idle, positive number)');
  console.log('  --threshold P           Silence threshold percent (0..100; default 0.5)');
  console.log('  --silence N             Silence duration before rotation in seconds (positive; default 1.0)');
  console.log('  --device <id>           Audio input device id (Windows waveaudio index; default 0)');
  console.log('  --max-chunk-seconds N   Force-rotate a chunk after N seconds even without silence');
  console.log('  --transcribe            Auto-transcribe each idle chunk; writes <basename>.txt next to the .wav');
  console.log('  --model <path>          Whisper.cpp ggml model path (default ./models/ggml-base.en.bin)');
  console.log('  --json                  Emit transcribe result as JSON instead of plain text');
}

function parseRecordArgs(args) {
  const parsed = parseSubcommandArgs(args, RECORD_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    output: positional[0] != null ? positional[0] : null,
    durationSeconds: flags.durationSeconds != null ? flags.durationSeconds : null,
    device: flags.device != null ? flags.device : null,
    name: flags.name != null ? flags.name : null,
    root: flags.root != null ? flags.root : null,
  };
}

function parseIdleArgs(args) {
  const parsed = parseSubcommandArgs(args, IDLE_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    directory: positional[0] != null ? positional[0] : null,
    idleThreshold: flags.idleThreshold != null ? flags.idleThreshold : null,
    idleSilenceSeconds: flags.idleSilenceSeconds != null ? flags.idleSilenceSeconds : null,
    device: flags.device != null ? flags.device : null,
    maxChunkSeconds: flags.maxChunkSeconds != null ? flags.maxChunkSeconds : null,
    durationSeconds: flags.durationSeconds != null ? flags.durationSeconds : null,
    name: flags.name != null ? flags.name : null,
    root: flags.root != null ? flags.root : null,
    transcribe: flags.transcribe === true,
    transcribeModel: flags.transcribeModel != null ? flags.transcribeModel : null,
  };
}

function parseListenArgs(args) {
  const parsed = parseSubcommandArgs(args, LISTEN_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length > 0) return { error: `unexpected extra argument: ${positional[0]}` };
  return {
    device: flags.device != null ? flags.device : null,
  };
}

function parseTranscribeArgs(args) {
  const parsed = parseSubcommandArgs(args, TRANSCRIBE_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length === 0) return { error: 'transcribe requires a <file.wav> positional argument' };
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    wav: positional[0],
    model: flags.model != null ? flags.model : null,
    json: flags.json === true,
  };
}

function compactOptions(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function runListen(args = []) {
  const parsed = parseListenArgs(args);
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }
  const recorder = new AudioRecorder(compactOptions({ device: parsed.device }));
  let windowPeak = 0;
  let lastRender = 0;

  try {
    recorder.listen((chunk) => {
      const p = peak16LE(chunk);
      if (p > windowPeak) windowPeak = p;
      const now = Date.now();
      if (now - lastRender < 100) return;
      const db = toDb(windowPeak);
      const bar = renderBar(windowPeak);
      const dbLabel = `${db.toFixed(1).padStart(6)} dBFS`;
      process.stdout.write(`\r${bar}  ${dbLabel}  `);
      windowPeak = 0;
      lastRender = now;
    });
  } catch (err) {
    console.error('Could not start listening:', err.message);
    return 1;
  }

  console.log('Press Ctrl+C to stop.');

  const shutdown = () => {
    try { recorder.stop(); } catch (e) { /* not active */ }
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return 0;
}

// Helper: ask whisper.cpp for its banner so the --json output can include a `version`
// field per T-2's spec. Best-effort; on failure we return null and the caller emits
// version: null.
function getBinaryVersionInfo(binaryName) {
  try {
    const probe = probeBinary(binaryName);
    if (!probe || !probe.ok) return null;
    return parseWhisperHelp(probe.stdout || probe.stderr || '');
  } catch (_) {
    return null;
  }
}

async function runTranscribe(args = []) {
  const parsed = parseTranscribeArgs(args);
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }
  const model = parsed.model || DEFAULT_MODEL_PATH;

  let result;
  try {
    result = await transcribeFile({ wav: parsed.wav, model });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (err.stderr) {
      const head = err.stderr.split(/\r?\n/).filter(Boolean).slice(0, 3).join('\n  ');
      if (head) console.error(`  whisper-cli stderr:\n  ${head}`);
    }
    return 1;
  }

  if (parsed.json) {
    const versionInfo = getBinaryVersionInfo(result.binary);
    const payload = {
      text: result.text,
      model: result.model,
      wav: result.wav,
      durationMs: result.durationMs,
      binary: result.binary,
      txtPath: result.txtPath,
      version: versionInfo && versionInfo.version ? versionInfo.version : null,
      versionLabel: versionInfo ? versionInfo.label : null,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.text}\n`);
  }
  return 0;
}

async function runDevices() {
  let result;
  try {
    result = await enumerateDevices();
  } catch (err) {
    console.error('Could not enumerate audio devices:', err.message);
    return 1;
  }
  const { devices } = result;
  if (devices.length === 0) {
    console.warn('No audio input devices detected by sox.');
    console.warn('Check that a microphone is connected and the sox waveaudio driver is available.');
    return 1;
  }
  console.log('LocalRecorder — audio inputs visible to sox');
  console.log('');
  console.log('  INDEX    NAME');
  for (const d of devices) {
    const label = d.isDefault ? 'default' : String(d.index);
    console.log(`  ${label.padEnd(7)}  ${d.name}`);
  }
  console.log('');
  console.log('Use the index with future capture commands (not yet implemented).');
  return 0;
}

async function main(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || ['help', '--help', '-h'].includes(command)) {
    printHelp();
    return 0;
  }

  if (command === 'devices') {
    return runDevices();
  }

  const tail = args.slice(1);

  if (command === 'listen') {
    return runListen(tail);
  }

  if (command === 'transcribe') {
    return runTranscribe(tail);
  }

  if (!['record', 'idle'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  let recordTarget;
  let idleDirectory;
  let sessionDir;
  let durationSeconds = null;
  let recorderOptions = {};

  if (command === 'record') {
    const parsed = parseRecordArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    const resolved = resolveRecordPath({
      root: parsed.root || undefined,
      name: parsed.name,
      explicitPath: parsed.output,
    });
    recordTarget = resolved.filePath;
    sessionDir = resolved.sessionDir;
    durationSeconds = parsed.durationSeconds;
    recorderOptions = compactOptions({ device: parsed.device });
  } else {
    const parsed = parseIdleArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    // Up-front model check: if the user asked for --transcribe but the model
    // file doesn't exist, fail fast instead of capturing for an hour and then
    // surfacing "transcribe failed" on every single chunk.
    if (parsed.transcribe) {
      const modelPath = parsed.transcribeModel || DEFAULT_MODEL_PATH;
      if (!fs.existsSync(modelPath)) {
        console.error(`Error: --transcribe is set but model file not found: ${modelPath}`);
        console.error('  Pass --model <path>, or download a model:');
        console.error('  https://huggingface.co/ggerganov/whisper.cpp/tree/main');
        return 1;
      }
    }
    const resolved = resolveIdleDirectory({
      root: parsed.root || undefined,
      name: parsed.name,
      explicitDir: parsed.directory,
    });
    idleDirectory = resolved.sessionDir;
    sessionDir = resolved.sessionDir;
    durationSeconds = parsed.durationSeconds;
    recorderOptions = compactOptions({
      device: parsed.device,
      idleThreshold: parsed.idleThreshold,
      idleSilenceSeconds: parsed.idleSilenceSeconds,
      maxChunkSeconds: parsed.maxChunkSeconds,
      transcribe: parsed.transcribe,
      transcribeModel: parsed.transcribeModel,
    });
  }

  // Ensure the session directory exists before opening any file streams.
  // idleListen does this internally too, but for record mode start() expects
  // the parent directory to already exist.
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (err) {
    console.error(`Error: could not create output directory ${sessionDir}: ${err.message}`);
    return 1;
  }

  const recorder = new AudioRecorder(recorderOptions);
  if (command === 'idle') {
    console.log(`Idle session directory: ${idleDirectory}`);
    recorder.idleListen(idleDirectory);
  } else {
    recorder.start(recordTarget);
  }

  let durationTimer = null;
  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (durationTimer) {
      clearTimeout(durationTimer);
      durationTimer = null;
    }
    if (reason) console.log(`\n${reason}`);
    try {
      recorder.stop();
    } catch (e) {
      // recorder was not active; safe to ignore
    }
    // Give the fileStream's 'close' event a tick to fire so the WAV header
    // fixup, sidecar write, AND (if --transcribe is on) the final chunk's
    // transcription enqueue all happen before we attempt to drain.
    await new Promise((r) => setTimeout(r, 250));
    // Wait for any queued / in-flight transcriptions to finish. No-op when
    // transcription is off. The queue is serial so total drain time is
    // sum(chunk_transcription_time) -- can be on the order of tens of seconds
    // for a long meeting; that's the right behaviour because exiting early
    // would orphan the .txt files we promised to produce.
    try {
      await recorder.drainTranscriptions();
    } catch (_) { /* drain() does not reject */ }
    process.exit(0);
  };

  const wireShutdown = (reason) => {
    shutdown(reason).catch((err) => {
      console.error('Shutdown error:', err);
      process.exit(1);
    });
  };

  process.on('SIGINT', () => wireShutdown('Stopping...'));
  process.on('SIGTERM', () => wireShutdown('Stopping...'));

  if (durationSeconds !== null) {
    const label = command === 'idle' ? 'Listening' : 'Recording';
    console.log(`${label} for ${durationSeconds}s. Press Ctrl+C to stop early.`);
    durationTimer = setTimeout(() => wireShutdown(`Reached ${durationSeconds}s, stopping.`), durationSeconds * 1000);
  }

  return 0;
}

if (require.main === module) {
  main(process.argv)
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error('Unexpected error:', err);
      process.exit(2);
    });
}

module.exports = {
  main,
  printHelp,
  runDevices,
  runListen,
  runTranscribe,
  parseRecordArgs,
  parseIdleArgs,
  parseListenArgs,
  parseTranscribeArgs,
  parseSubcommandArgs,
};
