// Path resolution for structured recording output (MS-10).
//
// The canonical layout under DEFAULT_ROOT (./recordings) is:
//
//   recordings/
//     <YYYY-MM-DD>/                    unnamed session (record + idle)
//       recording-<ts>.wav             single-file record mode
//       chunk-<ts>-<ms>.wav            idle-mode chunks
//       chunk-<ts>-<ms>.json           MS-8 sidecar
//     <YYYY-MM-DD>/<name>/             named session (--name, slugified)
//       <name>-<ts>.wav                record mode
//       chunk-<ts>-<ms>.wav            idle chunks under the same name/date
//
// Same (date, name) pair reuses one folder; timestamped basenames stay unique.
//
// Legacy paths still work: callers can pass an explicit path (record) or an
// explicit directory (idle), and we use it verbatim with no further layout
// magic. That's how the very first releases of this project were used and we
// preserve that contract.

const path = require('path');

const DEFAULT_ROOT = './recordings';
const NAME_SAFE_RE = /[^a-zA-Z0-9._-]+/g;
const RESERVED_NAMES = new Set(['', '.', '..']);

function sanitizeName(rawName) {
  if (typeof rawName !== 'string') return null;
  const slug = rawName
    .trim()
    .replace(/\.{2,}/g, '-') // collapse path-traversal dot runs ('..', '...', etc.)
    .replace(NAME_SAFE_RE, '-')
    .replace(/-+/g, '-') // collapse consecutive dashes
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) return null;
  if (RESERVED_NAMES.has(slug)) return null;
  return slug;
}

function isoSortableTimestamp(now = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function isoDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function resolveRecordPath({
  root = DEFAULT_ROOT,
  name = null,
  explicitPath = null,
  now = new Date(),
} = {}) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    return {
      filePath: resolved,
      sessionDir: path.dirname(resolved),
      explicit: true,
    };
  }
  const ts = isoSortableTimestamp(now);
  const clean = sanitizeName(name);
  if (clean) {
    const sessionDir = path.resolve(root, isoDate(now), clean);
    return {
      filePath: path.join(sessionDir, `${clean}-${ts}.wav`),
      sessionDir,
      explicit: false,
      label: clean,
    };
  }
  const sessionDir = path.resolve(root, isoDate(now));
  return {
    filePath: path.join(sessionDir, `recording-${ts}.wav`),
    sessionDir,
    explicit: false,
  };
}

function resolveIdleDirectory({
  root = DEFAULT_ROOT,
  name = null,
  explicitDir = null,
  now = new Date(),
} = {}) {
  if (explicitDir) {
    return { sessionDir: path.resolve(explicitDir), explicit: true };
  }
  const clean = sanitizeName(name);
  if (clean) {
    return {
      sessionDir: path.resolve(root, isoDate(now), clean),
      explicit: false,
      label: clean,
    };
  }
  return {
    sessionDir: path.resolve(root, isoDate(now)),
    explicit: false,
  };
}

module.exports = {
  DEFAULT_ROOT,
  sanitizeName,
  isoSortableTimestamp,
  isoDate,
  resolveRecordPath,
  resolveIdleDirectory,
};
