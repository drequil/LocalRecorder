// Shared download for whisper.cpp multilingual ggml-base.bin (used by CLI tool and --multilingual).

const fs = require('fs');
const https = require('https');
const path = require('path');

const DEFAULT_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

function getOnce(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'LocalRecorder/1 downloadGgmlBaseBin.js' } }, resolve)
      .on('error', reject);
  });
}

async function downloadGgmlBaseBin(destPath, { startUrl = DEFAULT_URL } = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  let url = startUrl;
  for (let hop = 0; hop < 8; hop += 1) {
    const res = await getOnce(url);
    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
      const loc = res.headers.location;
      res.resume();
      if (!loc) throw new Error(`Redirect without Location from ${url}`);
      url = new URL(loc, url).href;
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode} for ${url}`);
    }
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    });
    return destPath;
  }
  throw new Error('Too many redirects');
}

const MIN_BYTES = 1_000_000;

async function downloadGgmlBaseBinIfMissing(destPath, { fsImpl = fs, log = console.log } = {}) {
  try {
    if (fsImpl.existsSync(destPath)) {
      const st = fsImpl.statSync(destPath);
      if (st.size >= MIN_BYTES) return { downloaded: false, path: destPath };
    }
  } catch (_) {
    /* download */
  }
  log('Downloading multilingual model ggml-base.bin (first run, ~140 MB)…');
  await downloadGgmlBaseBin(destPath, {});
  log(`Model ready: ${destPath}`);
  return { downloaded: true, path: destPath };
}

module.exports = {
  DEFAULT_URL,
  downloadGgmlBaseBin,
  downloadGgmlBaseBinIfMissing,
  MIN_BYTES,
};
