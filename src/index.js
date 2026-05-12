const path = require('path');
const AudioRecorder = require('./audioRecorder');
const { enumerateDevices } = require('./audioDevices');
const { peak16LE, toDb, renderBar } = require('./audioLevels');

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
};

const IDLE_FLAGS = {
  '--threshold': { type: 'percent', as: 'idleThreshold' },
  '--silence': { type: 'positiveNumber', as: 'idleSilenceSeconds' },
  '--device': { type: 'string', as: 'device' },
  '--max-chunk-seconds': { type: 'positiveNumber', as: 'maxChunkSeconds' },
};

const LISTEN_FLAGS = {
  '--device': { type: 'string', as: 'device' },
};

function printHelp() {
  console.log('LocalRecorder v0.1.0');
  console.log('');
  console.log('Subcommands:');
  console.log('  devices                                    List audio input devices visible to sox');
  console.log('  listen   [--device <id>]                   Live peak-level meter (no file written)');
  console.log('  record <out.wav> [--duration N] [--device <id>]');
  console.log('                                             Record one WAV (Ctrl+C, or stop after N seconds)');
  console.log('  idle    <directory> [--threshold P] [--silence N] [--device <id>] [--max-chunk-seconds N]');
  console.log('                                             Per-silence WAV chunks + JSON sidecars into <directory>');
  console.log('  help                                       Show this help');
  console.log('');
  console.log('Flag notes:');
  console.log('  --duration N            Stop after N seconds (positive number)');
  console.log('  --threshold P           Silence threshold percent (0..100; default 0.5)');
  console.log('  --silence N             Silence duration before rotation in seconds (positive; default 1.0)');
  console.log('  --device <id>           Audio input device id (Windows waveaudio index; default 0)');
  console.log('  --max-chunk-seconds N   Force-rotate a chunk after N seconds even without silence');
}

function parseRecordArgs(args) {
  const parsed = parseSubcommandArgs(args, RECORD_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length === 0) return { error: 'output file path required' };
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    output: positional[0],
    durationSeconds: flags.durationSeconds != null ? flags.durationSeconds : null,
    device: flags.device != null ? flags.device : null,
  };
}

function parseIdleArgs(args) {
  const parsed = parseSubcommandArgs(args, IDLE_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length === 0) return { error: 'output directory required' };
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    directory: positional[0],
    idleThreshold: flags.idleThreshold != null ? flags.idleThreshold : null,
    idleSilenceSeconds: flags.idleSilenceSeconds != null ? flags.idleSilenceSeconds : null,
    device: flags.device != null ? flags.device : null,
    maxChunkSeconds: flags.maxChunkSeconds != null ? flags.maxChunkSeconds : null,
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

  if (!['record', 'idle'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  let recordTarget;
  let idleDirectory;
  let durationSeconds = null;
  let recorderOptions = {};

  if (command === 'record') {
    const parsed = parseRecordArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    recordTarget = path.resolve(parsed.output);
    durationSeconds = parsed.durationSeconds;
    recorderOptions = compactOptions({ device: parsed.device });
  } else {
    const parsed = parseIdleArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    idleDirectory = path.resolve(parsed.directory);
    recorderOptions = compactOptions({
      device: parsed.device,
      idleThreshold: parsed.idleThreshold,
      idleSilenceSeconds: parsed.idleSilenceSeconds,
      maxChunkSeconds: parsed.maxChunkSeconds,
    });
  }

  const recorder = new AudioRecorder(recorderOptions);
  if (command === 'idle') {
    recorder.idleListen(idleDirectory);
  } else {
    recorder.start(recordTarget);
  }

  let durationTimer = null;
  const shutdown = (reason) => {
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
    // fixup can run before the process exits.
    setTimeout(() => process.exit(0), 150);
  };

  process.on('SIGINT', () => shutdown('Stopping...'));
  process.on('SIGTERM', () => shutdown('Stopping...'));

  if (durationSeconds !== null) {
    console.log(`Recording for ${durationSeconds}s. Press Ctrl+C to stop early.`);
    durationTimer = setTimeout(() => shutdown(`Reached ${durationSeconds}s, stopping.`), durationSeconds * 1000);
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
  parseRecordArgs,
  parseIdleArgs,
  parseListenArgs,
  parseSubcommandArgs,
};
