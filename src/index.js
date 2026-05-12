const path = require('path');
const AudioRecorder = require('./audioRecorder');
const { enumerateDevices } = require('./audioDevices');
const { peak16LE, toDb, renderBar } = require('./audioLevels');

function printHelp() {
  console.log('LocalRecorder v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  node src/index.js devices                              List audio input devices visible to sox');
  console.log('  node src/index.js listen                               Live peak-level meter (no file written)');
  console.log('  node src/index.js record <output.wav> [--duration N]   Record (Ctrl+C, or stop after N seconds)');
  console.log('  node src/index.js idle <directory>                     Idle listening; one WAV per silence-delimited chunk');
  console.log('  node src/index.js help                                 Show this help');
}

function parseRecordArgs(args) {
  let output = null;
  let durationSeconds = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--duration') {
      const next = args[i + 1];
      if (next === undefined) {
        return { error: '--duration requires a value (seconds, positive number)' };
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: `--duration must be a positive number, got ${JSON.stringify(next)}` };
      }
      durationSeconds = parsed;
      i += 1;
      continue;
    }
    if (a.startsWith('--duration=')) {
      const raw = a.slice('--duration='.length);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: `--duration must be a positive number, got ${JSON.stringify(raw)}` };
      }
      durationSeconds = parsed;
      continue;
    }
    if (a.startsWith('--')) {
      return { error: `unknown flag: ${a}` };
    }
    if (output === null) {
      output = a;
      continue;
    }
    return { error: `unexpected extra argument: ${a}` };
  }
  if (!output) {
    return { error: 'output file path required' };
  }
  return { output, durationSeconds };
}

function runListen() {
  const recorder = new AudioRecorder();
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

  if (command === 'listen') {
    return runListen();
  }

  if (!['record', 'idle'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  const tail = args.slice(1);
  let recordTarget;
  let idleDirectory;
  let durationSeconds = null;

  if (command === 'record') {
    const parsed = parseRecordArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    recordTarget = path.resolve(parsed.output);
    durationSeconds = parsed.durationSeconds;
  } else {
    const target = tail[0];
    if (!target) {
      console.error('Error: output directory required');
      return 1;
    }
    idleDirectory = path.resolve(target);
  }

  const recorder = new AudioRecorder();
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

module.exports = { main, printHelp, runDevices, runListen, parseRecordArgs };
