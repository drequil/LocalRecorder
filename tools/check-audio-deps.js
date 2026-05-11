#!/usr/bin/env node
// MS-1: probe whether the audio capture toolchain (sox) is installed and callable.
// node-record-lpcm16 shells out to sox; without sox on PATH, all audio capture fails at runtime.

const { spawn } = require('child_process');

function tryRun(command, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = spawn(command, args, { windowsHide: true });
    child.on('error', (err) => settle({ ok: false, error: err }));
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => settle({ ok: code === 0, code, stdout, stderr }));
  });
}

function printInstallHints() {
  const lines = [];
  lines.push('');
  lines.push('LocalRecorder needs `sox` on PATH for audio capture.');
  lines.push('(node-record-lpcm16 spawns sox under the hood.)');
  lines.push('');

  if (process.platform === 'win32') {
    lines.push('Windows install options:');
    lines.push('  winget search sox        # find the current package id');
    lines.push('  winget install <id>      # install it');
    lines.push('  -- or --');
    lines.push('  choco install sox.portable');
    lines.push('  -- or --');
    lines.push('  Download: https://sourceforge.net/projects/sox/files/sox/');
    lines.push('');
    lines.push('After install:');
    lines.push('  1. Confirm sox.exe lives somewhere like C:\\Program Files (x86)\\sox-X.Y.Z\\');
    lines.push('  2. Add that folder to your user or system PATH.');
    lines.push('  3. Open a NEW shell so PATH refreshes.');
  } else if (process.platform === 'darwin') {
    lines.push('macOS install:');
    lines.push('  brew install sox');
  } else {
    lines.push('Linux install:');
    lines.push('  sudo apt install sox        # Debian/Ubuntu');
    lines.push('  sudo dnf install sox        # Fedora');
    lines.push('  sudo pacman -S sox          # Arch');
  }

  lines.push('');
  lines.push('Then re-run: npm run audio:check');
  return lines.join('\n');
}

async function main() {
  const result = await tryRun('sox', ['--version']);

  if (result.error && result.error.code === 'ENOENT') {
    console.error('FAIL: `sox` not found on PATH.');
    console.error(printInstallHints());
    return 1;
  }

  if (result.error) {
    console.error('FAIL: could not invoke sox:', result.error.message);
    console.error(printInstallHints());
    return 1;
  }

  if (!result.ok) {
    console.error(`FAIL: sox exited with status ${result.code}.`);
    if (result.stderr) console.error(result.stderr.trim());
    return 1;
  }

  const versionLine = (result.stdout || result.stderr)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || '(no version line returned)';
  console.log('OK: sox is callable.');
  console.log(`     ${versionLine}`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error('Unexpected error in audio:check:', err);
      process.exit(2);
    });
}

module.exports = { main, tryRun, printInstallHints };
