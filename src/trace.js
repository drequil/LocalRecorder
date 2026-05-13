// Optional diagnostic logging for the capture + transcription pipeline.
// Enable with either:
//   LOCALRECORDER_TRACE=1   (or true / yes / on)
//   --trace                 (record / idle; sets the env var before the recorder starts)

function isTraceEnabled() {
  const v = process.env.LOCALRECORDER_TRACE;
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function trace(stage, message, extra = undefined) {
  if (!isTraceEnabled()) return;
  const ts = new Date().toISOString();
  const prefix = `[lr:trace ${ts}] [${stage}]`;
  if (extra !== undefined && extra !== null) {
    let detail;
    try {
      detail = typeof extra === 'string' ? extra : JSON.stringify(extra);
    } catch (_) {
      detail = String(extra);
    }
    console.error(`${prefix} ${message} ${detail}`);
  } else {
    console.error(`${prefix} ${message}`);
  }
}

function enableTraceFromCli() {
  process.env.LOCALRECORDER_TRACE = '1';
}

module.exports = {
  isTraceEnabled,
  trace,
  enableTraceFromCli,
};
