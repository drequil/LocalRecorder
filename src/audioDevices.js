const { spawn } = require('child_process');

const ENUMERATION_REGEX = /waveaudio:\s+Enumerating input device\s+(-?\d+):\s+"([^"]+)"/g;

const PROBE_ARGS = ['-V6', '-t', 'waveaudio', '__localrecorder_probe__', '-n'];

function parseEnumeration(text) {
  if (!text) return [];
  const devices = [];
  for (const match of String(text).matchAll(ENUMERATION_REGEX)) {
    const index = Number.parseInt(match[1], 10);
    const name = match[2];
    devices.push({
      index,
      name,
      isDefault: index === -1,
    });
  }
  return devices;
}

function runSoxProbe({ spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let stderr = '';
    let stdout = '';
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = spawnFn('sox', PROBE_ARGS, { windowsHide: true });
    child.on('error', (err) => settle({ ok: false, error: err, stderr, stdout }));
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => settle({ ok: true, code, stderr, stdout }));
  });
}

async function enumerateDevices(opts = {}) {
  const result = await runSoxProbe(opts);
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      const err = new Error('sox not found on PATH. Run `npm run audio:check` for install hints.');
      err.cause = result.error;
      throw err;
    }
    throw result.error;
  }
  const devices = parseEnumeration(result.stderr);
  return { devices, raw: result.stderr };
}

module.exports = {
  enumerateDevices,
  parseEnumeration,
  runSoxProbe,
  PROBE_ARGS,
};
