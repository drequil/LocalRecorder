const path = require('path');
const AudioRecorder = require('./audioRecorder');
const { enumerateDevices } = require('./audioDevices');
const { peak16LE, toDb, renderBar } = require('./audioLevels');

function printHelp() {
  console.log('LocalRecorder v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  node src/index.js devices               List audio input devices visible to sox');
  console.log('  node src/index.js listen                Live peak-level meter (no file written)');
  console.log('  node src/index.js record <output.wav>   Start a recording (Ctrl+C to stop)');
  console.log('  node src/index.js idle <output.wav>     Idle listening with silence detection');
  console.log('  node src/index.js help                  Show this help');
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

  const target = args[1];
  if (!target) {
    console.error('Error: output file path required');
    return 1;
  }

  const recorder = new AudioRecorder();
  const outputPath = path.resolve(target);

  if (command === 'idle') {
    recorder.idleListen(outputPath);
  } else {
    recorder.start(outputPath);
  }

  const shutdown = () => {
    console.log('\nStopping...');
    try {
      recorder.stop();
    } catch (e) {
      // recorder was not active; safe to ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

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

module.exports = { main, printHelp, runDevices, runListen };
