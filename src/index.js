const path = require('path');
const AudioRecorder = require('./audioRecorder');

function printHelp() {
  console.log('LocalRecorder v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  node src/index.js record <output.wav>   Start a recording (Ctrl+C to stop)');
  console.log('  node src/index.js idle <output.wav>     Idle listening with silence detection');
  console.log('  node src/index.js help                  Show this help');
}

function main(argv) {
  const [command, target] = argv.slice(2);

  if (!command || ['help', '--help', '-h'].includes(command)) {
    printHelp();
    return 0;
  }

  if (!['record', 'idle'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

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
  const code = main(process.argv);
  if (code !== 0) {
    process.exit(code);
  }
}

module.exports = { main, printHelp };
