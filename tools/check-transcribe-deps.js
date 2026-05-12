#!/usr/bin/env node
// T-1: probe whether a whisper.cpp CLI is installed and callable.
// Phase 4 transcription will spawn one of these binaries per chunk; without it on PATH,
// every transcription attempt would fail at runtime with an opaque ENOENT.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Order matters. whisper-cli is the recommended modern name; whisper is what some package
// managers (e.g. Homebrew's whisper-cpp formula) install; main is the legacy name from
// earlier whisper.cpp releases that some long-time users still keep on PATH.
const WHISPER_CANDIDATES = ['whisper-cli', 'whisper', 'main'];

function findOnPath(command, env = process.env) {
  const pathEnv = env.PATH || env.Path || '';
  if (!pathEnv) return null;
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  // On Windows a bare command name resolves through PATHEXT; mirror that here so the
  // reported path actually points at whisper-cli.exe rather than whisper-cli (which won't
  // exist on disk).
  const exts = process.platform === 'win32'
    ? ((env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean))
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch (_) {
        // ENOENT / EACCES on a single PATH entry is normal; keep walking.
      }
    }
  }
  return null;
}

function probeBinary(command) {
  const result = spawnSync(command, ['--help'], {
    stdio: 'pipe',
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.error) return { ok: false, error: result.error };
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// Try each candidate in order. The first one that spawns and exits 0 wins. ENOENT just
// means "not installed under this name"; any other failure is preserved in `attempts` so
// the caller can surface a useful diagnostic.
function pickCandidateBinary(candidates, probe) {
  const attempts = [];
  for (const name of candidates) {
    const result = probe(name);
    attempts.push({ name, result });
    if (result && result.ok) return { picked: name, result, attempts };
  }
  return { picked: null, result: null, attempts };
}

// whisper.cpp does not implement --version; --help is the closest thing to a banner.
// Returns { label, version } when something useful is recognisable, or null when the
// help text has no parseable banner so the caller can fall back to "version unknown"
// instead of crashing on a future help-text rewrite.
function parseWhisperHelp(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const versionRegex = /\b(\d+\.\d+(?:\.\d+)?)\b/;
  for (const line of lines.slice(0, 8)) {
    if (/whisper/i.test(line)) {
      const m = line.match(versionRegex);
      return { label: line, version: m ? m[1] : null };
    }
  }
  return null;
}

function printInstallHints() {
  const lines = [];
  lines.push('');
  lines.push('LocalRecorder needs a whisper.cpp CLI on PATH for transcription.');
  lines.push(`Tried (in order): ${WHISPER_CANDIDATES.join(', ')}.`);
  lines.push('');

  if (process.platform === 'win32') {
    lines.push('Windows install:');
    lines.push('  1. Download a release ZIP from https://github.com/ggerganov/whisper.cpp/releases');
    lines.push('  2. Extract it (e.g. C:\\Tools\\whisper.cpp\\).');
    lines.push('  3. Add the folder containing whisper-cli.exe to your user or system PATH.');
    lines.push('  4. Open a NEW shell so PATH refreshes.');
    lines.push('');
    lines.push('Note: winget does not yet ship a whisper.cpp package; use the GitHub releases.');
  } else if (process.platform === 'darwin') {
    lines.push('macOS install:');
    lines.push('  brew install whisper-cpp');
    lines.push('  # Homebrew exposes the binary as `whisper-cli`.');
  } else {
    lines.push('Linux install:');
    lines.push('  # Some distros ship a whisper.cpp package; check your package manager first.');
    lines.push('  # Otherwise build from source:');
    lines.push('  git clone https://github.com/ggerganov/whisper.cpp');
    lines.push('  cd whisper.cpp && make');
    lines.push('  # Put the built whisper-cli (or main, on older releases) on your PATH.');
  }

  lines.push('');
  lines.push('Then re-run: npm run transcribe:check');
  return lines.join('\n');
}

function main() {
  const pick = pickCandidateBinary(WHISPER_CANDIDATES, probeBinary);

  if (!pick.picked) {
    const allMissing = pick.attempts.every(
      (a) => a.result && a.result.error && a.result.error.code === 'ENOENT'
    );
    if (allMissing) {
      console.error('FAIL: no whisper.cpp CLI found on PATH.');
    } else {
      console.error('FAIL: a whisper.cpp candidate was found but did not run cleanly.');
      for (const a of pick.attempts) {
        if (a.result && a.result.error) {
          if (a.result.error.code === 'ENOENT') continue;
          console.error(`  ${a.name}: ${a.result.error.message}`);
        } else if (a.result && !a.result.ok) {
          console.error(`  ${a.name}: exited with status ${a.result.status}`);
          const firstStderr = (a.result.stderr || '').split(/\r?\n/).find(Boolean);
          if (firstStderr) console.error(`    ${firstStderr}`);
        }
      }
    }
    console.error(printInstallHints());
    return 1;
  }

  const { picked, result } = pick;
  const resolvedPath = findOnPath(picked) || '(unknown — found via PATH but could not be located on disk)';
  const helpText = result.stdout || result.stderr || '';
  const versionInfo = parseWhisperHelp(helpText);

  console.log(`OK: whisper.cpp CLI \`${picked}\` is callable.`);
  console.log(`     path:    ${resolvedPath}`);
  if (versionInfo && versionInfo.version) {
    console.log(`     version: ${versionInfo.version}`);
    console.log(`     banner:  ${versionInfo.label}`);
  } else if (versionInfo) {
    console.log(`     banner:  ${versionInfo.label}`);
    console.log('     version: unknown (no semver in banner)');
  } else {
    console.log('     version: unknown (whisper.cpp --help has no recognisable banner)');
  }
  return 0;
}

if (require.main === module) {
  try {
    const code = main();
    if (code !== 0) process.exit(code);
  } catch (err) {
    console.error('Unexpected error in transcribe:check:', err);
    process.exit(2);
  }
}

module.exports = {
  WHISPER_CANDIDATES,
  findOnPath,
  pickCandidateBinary,
  parseWhisperHelp,
  printInstallHints,
  probeBinary,
  main,
};
