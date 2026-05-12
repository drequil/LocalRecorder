// Windows-only override for node-record-lpcm16's bundled sox recorder.
//
// The upstream sox recorder hardcodes `--default-device`, which fails on Windows
// because sox 14.4.2 has no concept of a "default audio device" on the waveaudio
// driver. The classic symptom is:
//
//   sox FAIL sox: Sorry, there is no default audio device configured
//
// We replace the recorder module's exports in require.cache BEFORE
// node-record-lpcm16 itself is required, so the library picks up our version.
// The replacement passes `-t waveaudio <device>` (the documented Windows form)
// and defaults the device to "0" (the first real input, as enumerated by
// `npm run docs:html` style probing -- see src/audioDevices.js / MS-2).
//
// On non-Windows platforms we leave the library alone so Linux/macOS keep using
// their working defaults.

const path = require('path');

const SOX_RECORDER_PATH = require.resolve('node-record-lpcm16/recorders/sox');

function windowsSoxRecorder(options) {
  const device = options.device != null ? String(options.device) : '0';
  const audioType = options.audioType || 'wav';

  let args = [
    '--no-show-progress',
    '-t', 'waveaudio',
    device,
    '--rate', String(options.sampleRate),
    '--channels', String(options.channels),
    '--encoding', 'signed-integer',
    '--bits', '16',
    '--type', audioType,
    '-',
  ];

  if (options.endOnSilence) {
    const start = (options.thresholdStart != null ? options.thresholdStart : options.threshold) + '%';
    const end = (options.thresholdEnd != null ? options.thresholdEnd : options.threshold) + '%';
    args = args.concat([
      'silence', '1', '0.1', start,
      '1', options.silence, end,
    ]);
  }

  return { cmd: 'sox', args, spawnOptions: {} };
}

let installed = false;

function install() {
  if (installed) return;
  if (process.platform !== 'win32') {
    installed = true;
    return;
  }
  require.cache[SOX_RECORDER_PATH] = {
    id: SOX_RECORDER_PATH,
    filename: SOX_RECORDER_PATH,
    loaded: true,
    children: [],
    exports: windowsSoxRecorder,
  };
  installed = true;
}

install();

module.exports = {
  install,
  windowsSoxRecorder,
  SOX_RECORDER_PATH,
};
