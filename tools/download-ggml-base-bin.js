#!/usr/bin/env node
// CLI wrapper: downloads whisper.cpp ggml-base.bin into ./models/ggml-base.bin

const path = require('path');
const { downloadGgmlBaseBin } = require('../src/downloadGgmlBaseBin');

const DEST = path.join(__dirname, '..', 'models', 'ggml-base.bin');

downloadGgmlBaseBin(DEST, {})
  .then(() => {
    const fs = require('fs');
    const st = fs.statSync(DEST);
    console.log(`Wrote ${DEST} (${st.size} bytes)`);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
