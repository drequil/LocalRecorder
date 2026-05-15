#!/usr/bin/env node
// GPU-4: download + extract a cuBLAS-enabled whisper.cpp build into
// `vendor/whisper-cuda/` so the rest of the project picks it up via the
// vendor-aware binary discovery added in this sprint (see
// `tools/check-transcribe-deps.js` -- `resolveWithVendor`).
//
// Windows-first: whisper.cpp publishes prebuilt cuBLAS ZIPs only for
// Windows x64. macOS / Linux users compile from source today. The installer
// refuses to run on non-Windows hosts with a clear message.
//
// Network: hits `https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest`
// and `https://github.com/.../releases/download/...`. No GitHub token required
// for public anonymous reads.
//
// Verification: if the release attaches a `<asset>.sha256` digest file, we
// download it too and verify the ZIP. If no digest is published we proceed
// over HTTPS and log a warning.
//
// Extraction: PowerShell's `Expand-Archive` on Windows; system `unzip`
// elsewhere (kept for the rare case someone runs this on WSL).
//
// Idempotency: a state file `vendor/whisper-cuda/.installed.json` records
// the release tag + asset name + sha256 of the last successful install. The
// installer skips re-download when the state matches the latest release.

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { VENDOR_WHISPER_CUDA_DIR } = require('./check-transcribe-deps');

const RELEASE_API_URL = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest';

// User-Agent is required by the GitHub API.
const USER_AGENT = 'localrecorder-gpu-installer/1.0';

// ---------------------------------------------------------------------------
// Asset picking
// ---------------------------------------------------------------------------

// Pure: pick the best cuBLAS asset for the host platform out of a release's
// asset list. Returns the matched asset object or null with a `reason`.
//
// Pattern: whisper.cpp's Windows cuBLAS asset names have varied over releases
// -- recent examples include:
//   - whisper-cublas-12.4.0-bin-x64.zip
//   - whisper-blas-cublas-bin-x64.zip
//   - whisper-cublas-bin-x64.zip
// We match anything that *both* contains "cublas" AND "x64" AND ends in .zip,
// case-insensitive. If multiple match (different CUDA toolkit versions on the
// same release), we pick the one with the highest CUDA version that we can
// parse from the name; lacking that, we pick the lexicographically last one
// for a stable choice.
function pickCublasAsset(release, { platform = process.platform, arch = process.arch } = {}) {
  if (!release || !Array.isArray(release.assets)) {
    return { asset: null, reason: 'no assets in release payload' };
  }
  // Today we only handle Windows x64. Other platforms fall through with a
  // clear message; the README points at the manual install path.
  if (platform !== 'win32') {
    return { asset: null, reason: `unsupported platform: ${platform} (Windows only for now)` };
  }
  if (arch !== 'x64') {
    return { asset: null, reason: `unsupported arch: ${arch} (x64 only)` };
  }
  const candidates = release.assets.filter((a) => {
    const n = String(a.name || '').toLowerCase();
    return n.endsWith('.zip') && n.includes('cublas') && (n.includes('x64') || n.includes('win'));
  });
  if (candidates.length === 0) {
    return { asset: null, reason: 'no cublas+x64 ZIP found in latest release assets' };
  }
  // Try to rank by embedded CUDA version (e.g. "12.4.0"). Highest wins.
  const ranked = candidates.slice().sort((a, b) => {
    const aV = (a.name.match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || '0';
    const bV = (b.name.match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || '0';
    const cmp = cmpVersion(bV, aV);
    if (cmp !== 0) return cmp;
    return b.name.localeCompare(a.name);
  });
  return { asset: ranked[0], reason: null };
}

// Compare dotted versions ("12.4.0" > "11.8" > "0"). Returns -1/0/1.
function cmpVersion(a, b) {
  const ap = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const bp = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] || 0;
    const bi = bp[i] || 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

// Pick the matching `*.sha256` (or `*.SHA256SUMS`) asset alongside the ZIP.
// whisper.cpp doesn't always publish one; the caller falls back to HTTPS-only
// trust in that case.
function pickShaAsset(release, zipAsset) {
  if (!release || !zipAsset || !Array.isArray(release.assets)) return null;
  const wantPrefix = String(zipAsset.name).toLowerCase();
  for (const a of release.assets) {
    const n = String(a.name || '').toLowerCase();
    if (!n.endsWith('.sha256') && !n.endsWith('.sha256sum') && !n.endsWith('.sha256sums')) continue;
    if (n.startsWith(wantPrefix) || n.includes(wantPrefix.replace(/\.zip$/, ''))) {
      return a;
    }
  }
  // Some releases ship a single "SHA256SUMS" covering everything.
  for (const a of release.assets) {
    const n = String(a.name || '').toLowerCase();
    if (n === 'sha256sums' || n === 'sha256sums.txt') return a;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGetJson(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json', ...headers },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetJson(res.headers.location, { headers }));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(new Error(`JSON parse failed for ${url}: ${err.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpDownloadToFile(url, destPath, { onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const tmp = `${destPath}.partial`;
    const file = fs.createWriteStream(tmp);
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        return resolve(httpDownloadToFile(res.headers.location, destPath, { onProgress }));
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let got = 0;
      res.on('data', (chunk) => {
        got += chunk.length;
        if (onProgress) onProgress(got, total);
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close((err) => {
          if (err) return reject(err);
          try {
            fs.renameSync(tmp, destPath);
            resolve(destPath);
          } catch (renameErr) {
            reject(renameErr);
          }
        });
      });
      file.on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        reject(err);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// SHA256
// ---------------------------------------------------------------------------

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Parse a `*.sha256` file. Two common formats:
//   "<hex>  <filename>"   (sha256sum -b style)
//   "<hex>"               (bare digest)
// Returns the lowercase hex digest, or null if the file is unparseable.
function parseShaFile(text, expectedFilename = null) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // "hex  filename" or "hex *filename"
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) {
      const [, hex, fname] = m;
      if (!expectedFilename || fname.toLowerCase() === expectedFilename.toLowerCase()) {
        return hex.toLowerCase();
      }
    } else if (/^[0-9a-fA-F]{64}$/.test(line)) {
      // Single-line digest file. Trust it.
      return line.toLowerCase();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    // Expand-Archive ships with every supported Windows. We force overwrite
    // so re-running the installer with a newer release succeeds.
    const ps = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
      { stdio: 'inherit', windowsHide: true },
    );
    if (ps.error) throw ps.error;
    if (ps.status !== 0) throw new Error(`Expand-Archive failed with status ${ps.status}`);
    return;
  }
  const unzip = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });
  if (unzip.error) throw new Error(`extraction failed: ${unzip.error.message}`);
  if (unzip.status !== 0) throw new Error(`unzip failed with status ${unzip.status}`);
}

// After extraction the cuBLAS ZIPs typically contain a "bin" subfolder or a
// versioned root folder. We flatten so binaries land directly under
// vendor/whisper-cuda/ where the discovery code expects them.
function flattenExtracted(destDir) {
  if (!fs.existsSync(destDir)) return;
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  // If whisper-cli.exe is already at the top, nothing to do.
  if (entries.some((e) => e.isFile() && /^whisper-cli(\.exe)?$/i.test(e.name))) return;
  // Otherwise look for it inside any single subdirectory.
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(destDir, e.name);
    const sFiles = fs.readdirSync(sub);
    if (sFiles.some((n) => /^whisper-cli(\.exe)?$/i.test(n))) {
      // Move every file in `sub` up to `destDir`, then rmdir sub.
      for (const fname of sFiles) {
        const from = path.join(sub, fname);
        const to = path.join(destDir, fname);
        try { fs.renameSync(from, to); }
        catch (_) {
          // Fall back to copy + unlink on cross-volume moves (rare on Windows).
          fs.copyFileSync(from, to);
          fs.unlinkSync(from);
        }
      }
      try { fs.rmdirSync(sub); } catch (_) { /* may have leftover dirs; ignore */ }
      return;
    }
    // Recurse one level only.
    const inner = fs.readdirSync(sub, { withFileTypes: true });
    for (const ie of inner) {
      if (!ie.isDirectory()) continue;
      const iSub = path.join(sub, ie.name);
      const iFiles = fs.readdirSync(iSub);
      if (iFiles.some((n) => /^whisper-cli(\.exe)?$/i.test(n))) {
        for (const fname of iFiles) {
          fs.renameSync(path.join(iSub, fname), path.join(destDir, fname));
        }
        try { fs.rmdirSync(iSub); } catch (_) { /* ignore */ }
        try { fs.rmdirSync(sub); } catch (_) { /* ignore */ }
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

const STATE_FILENAME = '.installed.json';

function readState(vendorDir) {
  try {
    const txt = fs.readFileSync(path.join(vendorDir, STATE_FILENAME), 'utf8');
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

function writeState(vendorDir, state) {
  try {
    fs.mkdirSync(vendorDir, { recursive: true });
    fs.writeFileSync(path.join(vendorDir, STATE_FILENAME), JSON.stringify(state, null, 2) + '\n');
  } catch (err) {
    console.warn(`[gpu:install] could not write state file: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main() {
  if (process.platform !== 'win32') {
    console.error('FAIL: `npm run gpu:install` is Windows-only today.');
    console.error('  whisper.cpp publishes prebuilt cuBLAS ZIPs only for Windows x64.');
    console.error('  On macOS / Linux, build whisper.cpp from source with CUDA support and put');
    console.error('  the binary on PATH (or copy into vendor/whisper-cuda/).');
    console.error('  See: https://github.com/ggerganov/whisper.cpp');
    return 2;
  }
  if (process.arch !== 'x64') {
    console.error(`FAIL: unsupported arch '${process.arch}'. whisper.cpp's cuBLAS prebuilt is x64-only.`);
    return 2;
  }

  console.log('[gpu:install] fetching latest whisper.cpp release...');
  let release;
  try {
    release = await httpGetJson(RELEASE_API_URL);
  } catch (err) {
    console.error(`FAIL: could not fetch release info: ${err.message}`);
    console.error('  Check your network or try again later. Manual install:');
    console.error('  https://github.com/ggerganov/whisper.cpp/releases');
    return 1;
  }

  const { asset, reason } = pickCublasAsset(release);
  if (!asset) {
    console.error(`FAIL: no suitable cuBLAS asset in release ${release.tag_name || '(unknown)'}: ${reason}`);
    console.error('  Manual install: https://github.com/ggerganov/whisper.cpp/releases');
    return 1;
  }
  console.log(`[gpu:install] release:  ${release.tag_name} (${release.name || ''})`);
  console.log(`[gpu:install] asset:    ${asset.name} (${humanBytes(asset.size)})`);
  console.log(`[gpu:install] url:      ${asset.browser_download_url}`);

  const prior = readState(VENDOR_WHISPER_CUDA_DIR);
  if (prior && prior.tag_name === release.tag_name && prior.asset === asset.name) {
    console.log(`[gpu:install] vendor/whisper-cuda/ already contains ${release.tag_name}; nothing to do.`);
    console.log('[gpu:install] To force a reinstall, delete vendor/whisper-cuda/.installed.json and re-run.');
    return 0;
  }

  fs.mkdirSync(VENDOR_WHISPER_CUDA_DIR, { recursive: true });
  const zipDest = path.join(VENDOR_WHISPER_CUDA_DIR, asset.name);

  console.log(`[gpu:install] downloading to ${zipDest}...`);
  let lastPct = -1;
  try {
    await httpDownloadToFile(asset.browser_download_url, zipDest, {
      onProgress: (got, total) => {
        if (!total) return;
        const pct = Math.floor((got / total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          process.stdout.write(`  ${pct.toString().padStart(3)}%  (${humanBytes(got)}/${humanBytes(total)})\r`);
          lastPct = pct;
        }
      },
    });
    process.stdout.write('\n');
  } catch (err) {
    console.error(`FAIL: download failed: ${err.message}`);
    return 1;
  }

  const actualHex = await sha256File(zipDest);
  console.log(`[gpu:install] downloaded sha256: ${actualHex}`);

  const shaAsset = pickShaAsset(release, asset);
  if (shaAsset) {
    const shaDest = path.join(VENDOR_WHISPER_CUDA_DIR, shaAsset.name);
    try {
      await httpDownloadToFile(shaAsset.browser_download_url, shaDest);
      const shaText = fs.readFileSync(shaDest, 'utf8');
      const expected = parseShaFile(shaText, asset.name);
      if (!expected) {
        console.warn(`[gpu:install] could not parse ${shaAsset.name}; skipping checksum verification`);
      } else if (expected.toLowerCase() !== actualHex.toLowerCase()) {
        console.error(`FAIL: checksum mismatch.`);
        console.error(`  expected: ${expected}`);
        console.error(`  actual:   ${actualHex}`);
        try { fs.unlinkSync(zipDest); } catch (_) { /* ignore */ }
        return 1;
      } else {
        console.log('[gpu:install] checksum: OK');
      }
    } catch (err) {
      console.warn(`[gpu:install] could not fetch ${shaAsset.name}: ${err.message}; proceeding without checksum verification`);
    }
  } else {
    console.warn('[gpu:install] release publishes no SHA256 digest; relying on HTTPS for integrity');
  }

  console.log(`[gpu:install] extracting into ${VENDOR_WHISPER_CUDA_DIR}...`);
  try {
    extractZip(zipDest, VENDOR_WHISPER_CUDA_DIR);
    flattenExtracted(VENDOR_WHISPER_CUDA_DIR);
  } catch (err) {
    console.error(`FAIL: extraction failed: ${err.message}`);
    return 1;
  }

  // Cleanup the ZIP itself (state file is the audit trail).
  try { fs.unlinkSync(zipDest); } catch (_) { /* ignore */ }

  writeState(VENDOR_WHISPER_CUDA_DIR, {
    tag_name: release.tag_name,
    asset: asset.name,
    sha256: actualHex,
    installedAt: new Date().toISOString(),
  });

  console.log('');
  console.log('[gpu:install] done.');
  console.log(`  Vendor binaries are now under: ${VENDOR_WHISPER_CUDA_DIR}`);
  console.log('  Verify with:  npm run gpu:check');
  return 0;
}

function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '?';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let u = 0;
  let v = n;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

if (require.main === module) {
  main()
    .then((code) => { if (code !== 0) process.exit(code); })
    .catch((err) => {
      console.error('Unexpected error in gpu:install:', err);
      process.exit(2);
    });
}

module.exports = {
  main,
  pickCublasAsset,
  pickShaAsset,
  cmpVersion,
  parseShaFile,
  humanBytes,
};
