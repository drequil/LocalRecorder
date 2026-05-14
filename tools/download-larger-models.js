#!/usr/bin/env node
// Downloads ggml-medium.bin and ggml-large-v3.bin into ./models/

const path = require('path');
const { downloadGgmlBaseBin } = require('../src/downloadGgmlBaseBin');
const fs = require('fs');

const MODELS_DIR = path.join(__dirname, '..', 'models');
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const targets = [
  { name: 'ggml-medium.bin',    url: `${HF_BASE}/ggml-medium.bin`,    sizeHint: '~1.5 GB' },
  { name: 'ggml-large-v3.bin',  url: `${HF_BASE}/ggml-large-v3.bin`,  sizeHint: '~3.1 GB' },
];

(async () => {
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  for (const t of targets) {
    const dest = path.join(MODELS_DIR, t.name);
    if (fs.existsSync(dest)) {
      const st = fs.statSync(dest);
      if (st.size > 100_000_000) {
        console.log(`[skip] ${t.name} already present (${(st.size / 1e9).toFixed(2)} GB)`);
        continue;
      }
    }
    console.log(`[download] ${t.name} (${t.sizeHint}) …`);
    const start = Date.now();
    await downloadGgmlBaseBin(dest, { startUrl: t.url });
    const st = fs.statSync(dest);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[done]     ${t.name}  ${(st.size / 1e9).toFixed(2)} GB  in ${elapsed}s`);
  }

  console.log('\nAll done. LocalRecorder will auto-pick the best available model.');
})().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
