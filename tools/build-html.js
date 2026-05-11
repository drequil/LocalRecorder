#!/usr/bin/env node
// Regenerates HTML mirrors of project markdown docs per .instructions.md rule 6.
// Inputs are listed in DOCS below; outputs land under docs/html/.

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'html');

const DOCS = [
  { src: 'README.md',            out: 'README.html',     title: 'LocalRecorder — README' },
  { src: '.instructions.md',     out: 'instructions.html', title: 'LocalRecorder — MDM Workflow Rules' },
  { src: 'docs/sprint-log.md',   out: 'sprint-log.html',  title: 'LocalRecorder — Sprint Log' },
  { src: 'docs/sprint-plan.md',  out: 'sprint-plan.html', title: 'LocalRecorder — Sprint Plan', optional: true },
];

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    max-width: 760px;
    margin: 2rem auto;
    padding: 0 1rem;
    line-height: 1.55;
  }
  h1, h2, h3, h4 { line-height: 1.25; }
  h1 { border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
  h2 { border-bottom: 1px solid #8882; padding-bottom: 0.2rem; margin-top: 2rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
  pre code { display: block; padding: 0.75rem; overflow-x: auto; background: #8881; border-radius: 4px; }
  :not(pre) > code { background: #8881; padding: 0.1rem 0.3rem; border-radius: 3px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #8884; padding: 0.4rem 0.6rem; }
  blockquote { border-left: 3px solid #8884; padding-left: 0.75rem; color: #888; }
  hr { border: none; border-top: 1px solid #8884; }
  .meta { color: #888; font-size: 0.85em; margin-bottom: 1.5rem; }
  .meta a { color: inherit; }
`;

function render(title, sourcePath, html) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <p class="meta">Generated from <code>${escapeHtml(sourcePath)}</code> &middot; <a href="../../${escapeHtml(sourcePath)}">view source</a></p>
${html}
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });

  const results = [];
  for (const doc of DOCS) {
    const absSrc = path.join(ROOT, doc.src);
    if (!fs.existsSync(absSrc)) {
      if (doc.optional) {
        results.push({ src: doc.src, status: 'skipped (missing optional source)' });
        continue;
      }
      throw new Error(`Required source not found: ${doc.src}`);
    }
    const md = fs.readFileSync(absSrc, 'utf8');
    const body = marked.parse(md);
    const html = render(doc.title, doc.src, body);
    const absOut = path.join(OUT_DIR, doc.out);
    fs.writeFileSync(absOut, html);
    results.push({ src: doc.src, out: path.relative(ROOT, absOut), status: 'ok' });
  }

  for (const r of results) {
    console.log(`${r.status.padEnd(34)} ${r.src}${r.out ? ' -> ' + r.out : ''}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('build-html failed:', err.message);
    process.exit(1);
  }
}

module.exports = { main, DOCS };
