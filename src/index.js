const fs = require('fs');
const os = require('os');
const path = require('path');
const AudioRecorder = require('./audioRecorder');
const { enumerateDevices } = require('./audioDevices');
const { peak16LE, toDb, renderBar } = require('./audioLevels');
const { resolveRecordPath, resolveIdleDirectory } = require('./recordingPaths');
const {
  effectiveRecordingsRoot,
  loadUserConfig,
  mergeTranscribeFieldsFromUserConfig,
  ensureDefaultUserConfigIfMissing,
  multilingualWhisperLanguageHint,
} = require('./userConfig');
const { downloadGgmlBaseBinIfMissing } = require('./downloadGgmlBaseBin');
const { resolveMultilingualModel } = require('./resolveMultilingualModel');
const { parsePresetFlags, resolvePresetModelAbs, resolveBestAvailableModel } = require('./whisperModelPreset');
const {
  DEFAULT_MODEL_PATH,
  transcribeFile,
  resolveBinary,
} = require('./transcribe');
const { probeBinary, parseWhisperHelp } = require('../tools/check-transcribe-deps');
const { trace, enableTraceFromCli } = require('./trace');

// Minimal subcommand flag parser. flagSpec maps `--flag-name` to a descriptor
// {type, as}. Supports `--flag value` and `--flag=value` shapes; rejects unknown
// flags and missing values. Returns { flags, positional } or { error }.
const COERCERS = {
  positiveNumber(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: `must be a positive number, got ${JSON.stringify(raw)}` };
    }
    return { value: n };
  },
  nonNegativeNumber(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { error: `must be a non-negative number, got ${JSON.stringify(raw)}` };
    }
    return { value: n };
  },
  percent(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { error: `must be a number 0..100, got ${JSON.stringify(raw)}` };
    }
    return { value: n };
  },
  string(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { error: 'must be a non-empty string' };
    }
    return { value: raw };
  },
  whisperLang(raw) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (t.length === 0) {
      return { error: 'must be a non-empty whisper language code (e.g. hi, en, auto)' };
    }
    if (t.length > 32) {
      return { error: `must be at most 32 characters, got ${t.length}` };
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t)) {
      return {
        error:
          `invalid language code ${JSON.stringify(raw)} — use letters, digits, hyphen, underscore (e.g. hi, auto)`,
      };
    }
    return { value: t };
  },
};

/** Map -m / -l to long flags (transcribe model presets; language stays --language). */
function expandWhisperPresetShortFlags(args) {
  return args.map((a) => {
    if (a === '-m') return '--medium';
    if (a === '-l') return '--large';
    return a;
  });
}

function parseSubcommandArgs(args, flagSpec) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    let inlineValue = null;
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      inlineValue = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a.startsWith('--')) {
      const spec = flagSpec[a];
      if (!spec) return { error: `unknown flag: ${a}` };
      // Boolean presence flag (no value, e.g. --json). Reject `--flag=value` shorthand
      // so we don't silently accept `--json=foo`; bare `--flag` is the only valid form.
      if (spec.type === 'flag') {
        if (inlineValue !== null) {
          return { error: `${a} does not take a value (got ${JSON.stringify(inlineValue)})` };
        }
        flags[spec.as] = true;
        continue;
      }
      let raw = inlineValue;
      if (raw === null) {
        raw = args[i + 1];
        if (raw === undefined) return { error: `${a} requires a value` };
        i += 1;
      }
      const coerce = COERCERS[spec.type];
      if (!coerce) return { error: `${a}: internal: unknown coercion type ${spec.type}` };
      const parsed = coerce(raw);
      if (parsed.error) return { error: `${a} ${parsed.error}` };
      flags[spec.as] = parsed.value;
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

/** --duration vs --duration-minutes (mutually exclusive); minutes → seconds. */
function resolveDurationFromFlags(flags) {
  const sec = flags.durationSeconds != null ? flags.durationSeconds : null;
  const min = flags.durationMinutes != null ? flags.durationMinutes : null;
  if (sec != null && min != null) {
    return { error: 'cannot use --duration together with --duration-minutes' };
  }
  if (min != null) {
    return { durationSeconds: min * 60 };
  }
  return { durationSeconds: sec };
}

/** Idle CLI: default 30s timed chunks, silence detector off; see help. */
function resolveIdleChunkKnobs(parsed) {
  let idleSilenceSeconds = parsed.idleSilenceSeconds;
  let maxChunkSeconds = parsed.maxChunkSeconds;
  const sUnset = idleSilenceSeconds == null;
  const mUnset = maxChunkSeconds == null;

  if (sUnset && mUnset) {
    return { idleSilenceSeconds: 0, maxChunkSeconds: 30 };
  }
  if (sUnset && !mUnset) {
    return { idleSilenceSeconds: 0, maxChunkSeconds };
  }
  if (!sUnset && mUnset) {
    if (idleSilenceSeconds === 0) {
      return { idleSilenceSeconds: 0, maxChunkSeconds: 30 };
    }
    return { idleSilenceSeconds, maxChunkSeconds: 0 };
  }
  return { idleSilenceSeconds, maxChunkSeconds };
}

// Whisper's beam-search saturates around 8 threads; beyond that extra threads
// add lock contention. Cap the auto-default so we don't starve other processes
// on a 24-core machine.
const WHISPER_MAX_AUTO_THREADS = 8;

// Hallucination suppression defaults (both are more conservative than whisper's
// built-in defaults of 0.6 / 2.4).
const WHISPER_NO_SPEECH_DEFAULT = 0.8;
const WHISPER_ENTROPY_DEFAULT = 2.8;

function resolveTranscribeThreads(cliValue) {
  if (cliValue != null && Number.isInteger(cliValue) && cliValue > 0) return cliValue;
  return Math.min(os.cpus().length, WHISPER_MAX_AUTO_THREADS);
}

function resolveNoSpeechThreshold(cliValue) {
  if (cliValue != null && Number.isFinite(cliValue) && cliValue >= 0) return cliValue;
  return WHISPER_NO_SPEECH_DEFAULT;
}

function resolveEntropyThreshold(cliValue) {
  if (cliValue != null && Number.isFinite(cliValue) && cliValue >= 0) return cliValue;
  return WHISPER_ENTROPY_DEFAULT;
}

const RECORD_FLAGS = {
  '--duration': { type: 'positiveNumber', as: 'durationSeconds' },
  '--duration-minutes': { type: 'positiveNumber', as: 'durationMinutes' },
  '--device': { type: 'string', as: 'device' },
  '--name': { type: 'string', as: 'name' },
  '--root': { type: 'string', as: 'root' },
  '--transcribe': { type: 'flag', as: 'transcribe' },
  '--no-transcribe': { type: 'flag', as: 'noTranscribe' },
  '--model': { type: 'string', as: 'transcribeModel' },
  '--language': { type: 'whisperLang', as: 'transcribeLanguage' },
  '--multilingual': { type: 'flag', as: 'multilingual' },
  '--medium': { type: 'flag', as: 'medium' },
  '--large': { type: 'flag', as: 'large' },
  '--transcribe-min-peak': { type: 'percent', as: 'transcribeMinPeak' },
  '--transcribe-queue-max': { type: 'positiveNumber', as: 'transcribeQueueMax' },
  '--transcribe-threads': { type: 'positiveNumber', as: 'transcribeThreads' },
  '--no-speech-thold': { type: 'positiveNumber', as: 'noSpeechThreshold' },
  '--entropy-thold': { type: 'positiveNumber', as: 'entropyThreshold' },
  '--trace': { type: 'flag', as: 'trace' },
};

const IDLE_FLAGS = {
  '--threshold': { type: 'percent', as: 'idleThreshold' },
  // --silence 0 explicitly disables sox's silence detector so chunks only
  // rotate on --max-chunk-seconds. Useful when the silence detector is
  // misbehaving in a noisy environment.
  '--silence': { type: 'nonNegativeNumber', as: 'idleSilenceSeconds' },
  '--device': { type: 'string', as: 'device' },
  '--max-chunk-seconds': { type: 'positiveNumber', as: 'maxChunkSeconds' },
  '--duration': { type: 'positiveNumber', as: 'durationSeconds' },
  '--duration-minutes': { type: 'positiveNumber', as: 'durationMinutes' },
  '--name': { type: 'string', as: 'name' },
  '--root': { type: 'string', as: 'root' },
  '--transcribe': { type: 'flag', as: 'transcribe' },
  '--model': { type: 'string', as: 'transcribeModel' },
  '--language': { type: 'whisperLang', as: 'transcribeLanguage' },
  '--multilingual': { type: 'flag', as: 'multilingual' },
  '--medium': { type: 'flag', as: 'medium' },
  '--large': { type: 'flag', as: 'large' },
  // T-5: peak gating. Accepts a number in [0, 1]; 0 disables the gate.
  // Validated as `percent` to reuse the 0..100 / 0..1 dual-parse helper.
  '--transcribe-min-peak': { type: 'percent', as: 'transcribeMinPeak' },
  // T-5: queue backlog warning threshold. 0 disables.
  '--transcribe-queue-max': { type: 'positiveNumber', as: 'transcribeQueueMax' },
  '--transcribe-threads': { type: 'positiveNumber', as: 'transcribeThreads' },
  '--no-speech-thold': { type: 'positiveNumber', as: 'noSpeechThreshold' },
  '--entropy-thold': { type: 'positiveNumber', as: 'entropyThreshold' },
  '--trace': { type: 'flag', as: 'trace' },
};

const LISTEN_FLAGS = {
  '--device': { type: 'string', as: 'device' },
};

const TRANSCRIBE_FLAGS = {
  '--model': { type: 'string', as: 'model' },
  '--language': { type: 'whisperLang', as: 'language' },
  '--multilingual': { type: 'flag', as: 'multilingual' },
  '--medium': { type: 'flag', as: 'medium' },
  '--large': { type: 'flag', as: 'large' },
  '--threads': { type: 'positiveNumber', as: 'transcribeThreads' },
  '--no-speech-thold': { type: 'positiveNumber', as: 'noSpeechThreshold' },
  '--entropy-thold': { type: 'positiveNumber', as: 'entropyThreshold' },
  '--json': { type: 'flag', as: 'json' },
};

function printHelp() {
  console.log('LocalRecorder v0.1.0');
  console.log('');
  console.log('Subcommands:');
  console.log('  devices                                                List audio input devices visible to sox');
  console.log('  listen   [--device <id>]                               Live peak-level meter (no file written)');
  console.log('  record   [<out.wav>] [--name <label>] [--root <dir>]   Continuous recording to one WAV (safety max: 4 h)');
  console.log('           [--duration N | --duration-minutes N] [--device <id>] [--transcribe | --no-transcribe] [--model <path>] [--medium|-m] [--large|-l]');
  console.log('           [--language <code>] [--multilingual] [--transcribe-min-peak P] [--transcribe-queue-max N] [--trace]');
  console.log('  chunk    [<directory>] [--name <label>] [--root <dir>]  Chunked WAV + JSON sidecars (default: 30 s chunks, silence detector off)');
  console.log('  idle     <same as chunk — legacy alias>');
  console.log('           [--threshold P] [--silence N] [--device <id>]');
  console.log('           [--duration N | --duration-minutes N] [--max-chunk-seconds N]');
  console.log('           [--transcribe] [--model <path>] [--medium|-m] [--large|-l] [--language <code>] [--multilingual] [--trace]');
  console.log('           [--transcribe-min-peak P] [--transcribe-queue-max N]');
  console.log('  transcribe <file.wav> [--model <path>] [--medium|-m] [--large|-l] [--language <code>] [--multilingual] [--json]');
  console.log('  help                                                   Show this help');
  console.log('');
  console.log('Output layout:');
  console.log('  --name <label>          <root>/<YYYY-MM-DD>/<label>/<label>-<ts>.wav (record)');
  console.log('                          <root>/<YYYY-MM-DD>/<label>/chunk-<ts>-<ms>.wav (chunk/idle)');
  console.log('  no name                 <root>/<YYYY-MM-DD>/recording-<ts>.wav (record)');
  console.log('                          <root>/<YYYY-MM-DD>/chunk-<ts>-<ms>.wav (chunk/idle)');
  console.log('  explicit positional     written literally; --name / --root / config ignored');
  console.log('  default <root>          ./recordings, or recordingsRoot in JSON config (see below)');
  console.log('  --root <dir>            override config and default ./recordings');
  console.log('');
  console.log('Config (optional):');
  console.log('  %USERPROFILE%\\.localrecorder\\config.json   JSON: { "recordingsRoot": "D:/recordings", "transcribeModel": "models/ggml-base.en.bin", "transcribeLanguage": "en" }');
  console.log('  LOCALRECORDER_CONFIG=<path>                 path to the same JSON shape');
  console.log('  See docs/localrecorder-config.example.json');
  console.log('');
  console.log('Flag notes:');
  console.log('  --duration N            Stop after N seconds (record + idle; positive number).');
  console.log('  --duration-minutes N    Same as --duration N×60 (e.g. 10 → 10 minutes). Mutually exclusive with --duration.');
  console.log('  --threshold P           Idle: sox silence % (0..100; default 0.1). Ignored when --silence 0.');
  console.log('  --silence N             Idle: seconds below threshold before rotating (0 = off). Default with no flags: 0 (use --max-chunk-seconds only).');
  console.log('  --device <id>           Audio input device id (Windows waveaudio index; default 0)');
  console.log('  --max-chunk-seconds N   Idle: force new chunk after N seconds. Default with no flags: 30. Combine with --silence > 0 to cap long speech runs.');
  console.log('  --transcribe            Force auto-transcribe (idle: each chunk; record: at end). On record, this is optional if the model file already exists — see below.');
  console.log('  --no-transcribe         record only: never run whisper after capture (WAV + sidecar only)');
  console.log('  --model <path>          Whisper.cpp ggml model (default ./models/ggml-base.en.bin). Non-English needs multilingual *.bin, not *.en.bin.');
  console.log('  --medium, -m            Use ./models/ggml-medium.bin when --model is omitted (slower, better quality).');
  console.log('  --large, -l             Use ./models/ggml-large-v3.bin when --model is omitted (slowest preset).');
  console.log('                          --model wins over --medium/--large if both are set.');
  console.log('  --language <code>       whisper.cpp -l: source language (hi, zh, en, auto, …). Config default applies except with --multilingual (then only CLI counts).');
  console.log('  --multilingual          Multilingual checkpoint; default models/ggml-base.bin (download if missing).');
  console.log('                          Omits -l for auto-detect unless you pass --language (use --language zh for Chinese).');
  console.log('                          With --model *.en.bin, uses sibling *.bin in the same folder (e.g. ggml-base.bin).');
  console.log('  record + default model: If ./models/ggml-base.en.bin exists, transcribe runs automatically after stop. Use --no-transcribe to skip.');
  console.log('  record safety max:      No --duration? Recording stops automatically after 4 hours.');
  console.log('  --transcribe-min-peak P Skip chunks whose sidecar peak < P (default 0.005 / ~-46 dBFS); 0 disables');
  console.log('  --transcribe-queue-max N  Warn when transcription queue depth > N (default 5); 0 disables');
  console.log('  --transcribe-threads N  CPU threads passed to whisper.cpp -t (default: min(cpus, 8))');
  console.log('  --no-speech-thold P     Drop segments whisper rates as non-speech above P (default 0.8; whisper default 0.6)');
  console.log('  --entropy-thold P       Drop uncertain segments above entropy P (default 2.8; whisper default 2.4)');
  console.log('  --trace                 Verbose stderr traces (also LOCALRECORDER_TRACE=1)');
  console.log('  --json                  Emit transcribe result as JSON instead of plain text');
}

function parseRecordArgs(args) {
  const parsed = parseSubcommandArgs(expandWhisperPresetShortFlags(args), RECORD_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  const pr = parsePresetFlags(flags);
  if (pr.error) return { error: pr.error };
  if (flags.transcribe === true && flags.noTranscribe === true) {
    return { error: 'cannot use --transcribe together with --no-transcribe' };
  }
  const dur = resolveDurationFromFlags(flags);
  if (dur.error) return { error: dur.error };
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    output: positional[0] != null ? positional[0] : null,
    durationSeconds: dur.durationSeconds,
    device: flags.device != null ? flags.device : null,
    name: flags.name != null ? flags.name : null,
    root: flags.root != null ? flags.root : null,
    transcribe: flags.transcribe === true,
    noTranscribe: flags.noTranscribe === true,
    transcribeModel: flags.transcribeModel != null ? flags.transcribeModel : null,
    transcribeLanguage: flags.transcribeLanguage != null ? flags.transcribeLanguage : null,
    multilingual: flags.multilingual === true,
    transcribeModelPreset: pr.transcribeModelPreset,
    transcribeMinPeak: flags.transcribeMinPeak != null ? flags.transcribeMinPeak : null,
    transcribeQueueMax: flags.transcribeQueueMax != null ? flags.transcribeQueueMax : null,
    transcribeThreads: flags.transcribeThreads != null ? flags.transcribeThreads : null,
    noSpeechThreshold: flags.noSpeechThreshold != null ? flags.noSpeechThreshold : null,
    entropyThreshold: flags.entropyThreshold != null ? flags.entropyThreshold : null,
    trace: flags.trace === true,
  };
}

function parseIdleArgs(args) {
  const parsed = parseSubcommandArgs(expandWhisperPresetShortFlags(args), IDLE_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  const pr = parsePresetFlags(flags);
  if (pr.error) return { error: pr.error };
  const dur = resolveDurationFromFlags(flags);
  if (dur.error) return { error: dur.error };
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    directory: positional[0] != null ? positional[0] : null,
    idleThreshold: flags.idleThreshold != null ? flags.idleThreshold : null,
    idleSilenceSeconds: flags.idleSilenceSeconds != null ? flags.idleSilenceSeconds : null,
    device: flags.device != null ? flags.device : null,
    maxChunkSeconds: flags.maxChunkSeconds != null ? flags.maxChunkSeconds : null,
    durationSeconds: dur.durationSeconds,
    name: flags.name != null ? flags.name : null,
    root: flags.root != null ? flags.root : null,
    transcribe: flags.transcribe === true,
    transcribeModel: flags.transcribeModel != null ? flags.transcribeModel : null,
    transcribeLanguage: flags.transcribeLanguage != null ? flags.transcribeLanguage : null,
    multilingual: flags.multilingual === true,
    transcribeModelPreset: pr.transcribeModelPreset,
    transcribeMinPeak: flags.transcribeMinPeak != null ? flags.transcribeMinPeak : null,
    transcribeQueueMax: flags.transcribeQueueMax != null ? flags.transcribeQueueMax : null,
    transcribeThreads: flags.transcribeThreads != null ? flags.transcribeThreads : null,
    noSpeechThreshold: flags.noSpeechThreshold != null ? flags.noSpeechThreshold : null,
    entropyThreshold: flags.entropyThreshold != null ? flags.entropyThreshold : null,
    trace: flags.trace === true,
  };
}

function parseListenArgs(args) {
  const parsed = parseSubcommandArgs(args, LISTEN_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  if (positional.length > 0) return { error: `unexpected extra argument: ${positional[0]}` };
  return {
    device: flags.device != null ? flags.device : null,
  };
}

function parseTranscribeArgs(args) {
  const parsed = parseSubcommandArgs(expandWhisperPresetShortFlags(args), TRANSCRIBE_FLAGS);
  if (parsed.error) return { error: parsed.error };
  const { flags, positional } = parsed;
  const pr = parsePresetFlags(flags);
  if (pr.error) return { error: pr.error };
  if (positional.length === 0) return { error: 'transcribe requires a <file.wav> positional argument' };
  if (positional.length > 1) return { error: `unexpected extra argument: ${positional[1]}` };
  return {
    wav: positional[0],
    model: flags.model != null ? flags.model : null,
    language: flags.language != null ? flags.language : null,
    multilingual: flags.multilingual === true,
    transcribeModelPreset: pr.transcribeModelPreset,
    transcribeThreads: flags.transcribeThreads != null ? flags.transcribeThreads : null,
    noSpeechThreshold: flags.noSpeechThreshold != null ? flags.noSpeechThreshold : null,
    entropyThreshold: flags.entropyThreshold != null ? flags.entropyThreshold : null,
    json: flags.json === true,
  };
}

function compactOptions(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// record: if the default model (or --model) exists on disk, enable post-stop
// transcription even when the user omits --transcribe — one command, Ctrl+C,
// whisper runs automatically. --no-transcribe opts out. idle/ never uses this
// (chunked capture would surprise-run whisper on every rotation).
function applyRecordAutoTranscribe(parsed) {
  if (parsed.noTranscribe) {
    return { ...parsed, transcribe: false, recordImplicitTranscribe: false };
  }
  if (parsed.transcribe) {
    return { ...parsed, recordImplicitTranscribe: false };
  }
  const modelRel = parsed.transcribeModel || DEFAULT_MODEL_PATH;
  const modelAbs = path.isAbsolute(modelRel)
    ? path.normalize(modelRel)
    : path.resolve(process.cwd(), modelRel);
  if (fs.existsSync(modelAbs)) {
    return { ...parsed, transcribe: true, recordImplicitTranscribe: true };
  }
  return { ...parsed, transcribe: false, recordImplicitTranscribe: false };
}

function runListen(args = []) {
  const parsed = parseListenArgs(args);
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }
  const recorder = new AudioRecorder(compactOptions({ device: parsed.device }));
  let windowPeak = 0;
  let lastRender = 0;

  try {
    recorder.listen((chunk) => {
      const p = peak16LE(chunk);
      if (p > windowPeak) windowPeak = p;
      const now = Date.now();
      if (now - lastRender < 100) return;
      const db = toDb(windowPeak);
      const bar = renderBar(windowPeak);
      const dbLabel = `${db.toFixed(1).padStart(6)} dBFS`;
      process.stdout.write(`\r${bar}  ${dbLabel}  `);
      windowPeak = 0;
      lastRender = now;
    });
  } catch (err) {
    console.error('Could not start listening:', err.message);
    return 1;
  }

  console.log('Press Ctrl+C to stop.');

  const shutdown = () => {
    try { recorder.stop(); } catch (e) { /* not active */ }
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return 0;
}

// Helper: ask whisper.cpp for its banner so the --json output can include a `version`
// field per T-2's spec. Best-effort; on failure we return null and the caller emits
// version: null.
function getBinaryVersionInfo(binaryName) {
  try {
    const probe = probeBinary(binaryName);
    if (!probe || !probe.ok) return null;
    return parseWhisperHelp(probe.stdout || probe.stderr || '');
  } catch (_) {
    return null;
  }
}

async function runTranscribe(args = []) {
  const parsed = parseTranscribeArgs(args);
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }
  ensureDefaultUserConfigIfMissing();
  const userCfg = loadUserConfig();
  let model;
  let language;
  const hasExplicitModel = parsed.model != null && String(parsed.model).trim() !== '';
  if (parsed.multilingual) {
    try {
      model = await resolveMultilingualModel({
        cliModelPath: hasExplicitModel ? parsed.model : null,
        preset: hasExplicitModel ? null : parsed.transcribeModelPreset,
        cwd: process.cwd(),
        log: console.log,
        downloadGgmlBaseBinIfMissing,
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    language = multilingualWhisperLanguageHint(parsed.language);
  } else {
    let modelRaw;
    if (hasExplicitModel) {
      modelRaw = parsed.model;
    } else if (parsed.transcribeModelPreset === 'medium' || parsed.transcribeModelPreset === 'large') {
      modelRaw = resolvePresetModelAbs(process.cwd(), parsed.transcribeModelPreset);
    } else {
      modelRaw = userCfg.transcribeModel || resolveBestAvailableModel(process.cwd());
    }
    model = path.isAbsolute(modelRaw) ? path.normalize(modelRaw) : path.resolve(process.cwd(), modelRaw);
    if (parsed.language != null && String(parsed.language).trim() !== '') {
      language = parsed.language;
    } else {
      language = userCfg.transcribeLanguage;
    }
  }
  const threads = resolveTranscribeThreads(parsed.transcribeThreads);
  const noSpeechThreshold = resolveNoSpeechThreshold(parsed.noSpeechThreshold);
  const entropyThreshold = resolveEntropyThreshold(parsed.entropyThreshold);
  trace('transcribe-cli', 'one-shot transcribe', { wav: parsed.wav, model, language: language || null, threads, noSpeechThreshold, entropyThreshold });

  let result;
  try {
    result = await transcribeFile({ wav: parsed.wav, model, language, threads, noSpeechThreshold, entropyThreshold });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (err.stderr) {
      const head = err.stderr.split(/\r?\n/).filter(Boolean).slice(0, 3).join('\n  ');
      if (head) console.error(`  whisper-cli stderr:\n  ${head}`);
    }
    return 1;
  }

  if (parsed.json) {
    const versionInfo = getBinaryVersionInfo(result.binary);
    const payload = {
      text: result.text,
      model: result.model,
      wav: result.wav,
      language: result.language,
      durationMs: result.durationMs,
      binary: result.binary,
      txtPath: result.txtPath,
      version: versionInfo && versionInfo.version ? versionInfo.version : null,
      versionLabel: versionInfo ? versionInfo.label : null,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.text}\n`);
  }
  return 0;
}

async function runDevices() {
  let result;
  try {
    result = await enumerateDevices();
  } catch (err) {
    console.error('Could not enumerate audio devices:', err.message);
    return 1;
  }
  const { devices } = result;
  if (devices.length === 0) {
    console.warn('No audio input devices detected by sox.');
    console.warn('Check that a microphone is connected and the sox waveaudio driver is available.');
    return 1;
  }
  console.log('LocalRecorder — audio inputs visible to sox');
  console.log('');
  console.log('  INDEX    NAME');
  for (const d of devices) {
    const label = d.isDefault ? 'default' : String(d.index);
    console.log(`  ${label.padEnd(7)}  ${d.name}`);
  }
  console.log('');
  console.log('Use the index with future capture commands (not yet implemented).');
  return 0;
}

async function main(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || ['help', '--help', '-h'].includes(command)) {
    printHelp();
    return 0;
  }

  if (command === 'devices') {
    return runDevices();
  }

  const tail = args.slice(1);

  if (command === 'listen') {
    return runListen(tail);
  }

  if (command === 'transcribe') {
    return runTranscribe(tail);
  }

  // 'chunk' is the user-facing alias for 'idle'.
  const effectiveCommand = command === 'chunk' ? 'idle' : command;

  if (!['record', 'idle'].includes(effectiveCommand)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  // Safety maximum for continuous record with no explicit duration.
  const RECORD_SAFETY_MAX_SECONDS = 4 * 60 * 60; // 4 hours

  let recordTarget;
  let idleDirectory;
  let sessionDir;
  let durationSeconds = null;
  let recorderOptions = {};

  if (effectiveCommand === 'record') {
    let parsed = parseRecordArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    if (parsed.trace) {
      enableTraceFromCli();
    }
    ensureDefaultUserConfigIfMissing();
    try {
      parsed = await mergeTranscribeFieldsFromUserConfig(parsed, loadUserConfig());
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    parsed = applyRecordAutoTranscribe(parsed);
    const modelPathForCheck = path.isAbsolute(parsed.transcribeModel || DEFAULT_MODEL_PATH)
      ? path.normalize(parsed.transcribeModel || DEFAULT_MODEL_PATH)
      : path.resolve(process.cwd(), parsed.transcribeModel || DEFAULT_MODEL_PATH);
    if (parsed.transcribe && !fs.existsSync(modelPathForCheck)) {
      console.error(`Error: --transcribe is set but model file not found: ${modelPathForCheck}`);
      console.error('  Pass --model <path>, or download a model:');
      console.error('  https://huggingface.co/ggerganov/whisper.cpp/tree/main');
      return 1;
    }
    if (parsed.recordImplicitTranscribe) {
      console.log(
        'Model file found — will transcribe automatically when recording stops (Ctrl+C or --duration). ' +
        'Use --no-transcribe for WAV + sidecar only.',
      );
    }
    const rootPick = effectiveRecordingsRoot(parsed.root);
    trace('cli', 'recordings root resolution', {
      source: rootPick.source,
      root: rootPick.root != null ? rootPick.root : '(default ./recordings)',
      configPath: rootPick.configPath,
    });
    const resolved = resolveRecordPath({
      root: rootPick.root,
      name: parsed.name,
      explicitPath: parsed.output,
    });
    recordTarget = resolved.filePath;
    sessionDir = resolved.sessionDir;
    durationSeconds = parsed.durationSeconds ?? RECORD_SAFETY_MAX_SECONDS;
    recorderOptions = compactOptions({
      device: parsed.device,
      transcribe: parsed.transcribe,
      transcribeModel: parsed.transcribeModel,
      transcribeLanguage: parsed.transcribeLanguage,
      transcribeMinPeak: parsed.transcribeMinPeak,
      transcribeQueueMax: parsed.transcribeQueueMax,
      transcribeThreads: resolveTranscribeThreads(parsed.transcribeThreads),
      noSpeechThreshold: resolveNoSpeechThreshold(parsed.noSpeechThreshold),
      entropyThreshold: resolveEntropyThreshold(parsed.entropyThreshold),
    });
  } else {
    let parsed = parseIdleArgs(tail);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      return 1;
    }
    if (parsed.trace) {
      enableTraceFromCli();
    }
    ensureDefaultUserConfigIfMissing();
    try {
      parsed = await mergeTranscribeFieldsFromUserConfig(parsed, loadUserConfig());
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    // Up-front model check: if the user asked for --transcribe but the model
    // file doesn't exist, fail fast instead of capturing for an hour and then
    // surfacing "transcribe failed" on every single chunk.
    if (parsed.transcribe) {
      const modelRel = parsed.transcribeModel || DEFAULT_MODEL_PATH;
      const modelPath = path.isAbsolute(modelRel)
        ? path.normalize(modelRel)
        : path.resolve(process.cwd(), modelRel);
      if (!fs.existsSync(modelPath)) {
        console.error(`Error: --transcribe is set but model file not found: ${modelPath}`);
        console.error('  Pass --model <path>, or download a model:');
        console.error('  https://huggingface.co/ggerganov/whisper.cpp/tree/main');
        return 1;
      }
    }
    const rootPick = effectiveRecordingsRoot(parsed.root);
    trace('cli', 'recordings root resolution', {
      source: rootPick.source,
      root: rootPick.root != null ? rootPick.root : '(default ./recordings)',
      configPath: rootPick.configPath,
    });
    const resolved = resolveIdleDirectory({
      root: rootPick.root,
      name: parsed.name,
      explicitDir: parsed.directory,
    });
    idleDirectory = resolved.sessionDir;
    sessionDir = resolved.sessionDir;
    durationSeconds = parsed.durationSeconds;
    const chunkKnobs = resolveIdleChunkKnobs(parsed);
    recorderOptions = compactOptions({
      device: parsed.device,
      idleThreshold: parsed.idleThreshold,
      idleSilenceSeconds: chunkKnobs.idleSilenceSeconds,
      maxChunkSeconds: chunkKnobs.maxChunkSeconds,
      transcribe: parsed.transcribe,
      transcribeModel: parsed.transcribeModel,
      transcribeLanguage: parsed.transcribeLanguage,
      transcribeMinPeak: parsed.transcribeMinPeak,
      transcribeQueueMax: parsed.transcribeQueueMax,
      transcribeThreads: resolveTranscribeThreads(parsed.transcribeThreads),
      noSpeechThreshold: resolveNoSpeechThreshold(parsed.noSpeechThreshold),
      entropyThreshold: resolveEntropyThreshold(parsed.entropyThreshold),
    });
  }

  // Ensure the session directory exists before opening any file streams.
  // idleListen does this internally too, but for record mode start() expects
  // the parent directory to already exist.
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (err) {
    console.error(`Error: could not create output directory ${sessionDir}: ${err.message}`);
    return 1;
  }

  const recorder = new AudioRecorder(recorderOptions);
  trace('cli', 'AudioRecorder constructed', {
    command: effectiveCommand,
    transcribe: !!recorderOptions.transcribe,
    transcribeModel: recorderOptions.transcribeModel,
    transcribeLanguage: recorderOptions.transcribeLanguage,
    sessionDir,
    ...(effectiveCommand === 'record' ? { recordTarget } : { idleDirectory }),
    ...(effectiveCommand === 'idle'
      ? {
          idleSilenceSeconds: recorderOptions.idleSilenceSeconds,
          maxChunkSeconds: recorderOptions.maxChunkSeconds,
        }
      : {}),
  });
  if (effectiveCommand === 'idle') {
    console.log(`Chunk session directory: ${idleDirectory}`);
    recorder.idleListen(idleDirectory);
  } else {
    recorder.start(recordTarget);
  }

  // Reassure the user that Ctrl+C will drain in-flight transcriptions before
  // exiting -- a common misconception is that Ctrl+C aborts the queue and
  // discards work. The shutdown() handler awaits drainTranscriptions() exactly
  // for this reason. The message only prints when transcription is on, since
  // there's nothing to drain otherwise.
  if (recorderOptions && recorderOptions.transcribe) {
    console.log('Press Ctrl+C to stop. Pending transcriptions will finish before exit.');
  }

  let durationTimer = null;
  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (durationTimer) {
      clearTimeout(durationTimer);
      durationTimer = null;
    }
    if (reason) console.log(`\n${reason}`);
    trace('shutdown', 'stop: calling recorder.stop()');
    try {
      recorder.stop();
    } catch (e) {
      // recorder was not active; safe to ignore
    }
    trace('shutdown', 'stop: recorder.stop() returned (or no-op)');
    // Give the fileStream's 'close' event a tick to fire so the WAV header
    // fixup, sidecar write, AND (if --transcribe is on) the final chunk's
    // transcription enqueue all happen before we attempt to drain.
    await new Promise((r) => setTimeout(r, 250));
    trace('shutdown', 'post-close grace (250ms) elapsed');
    // Wait for any queued / in-flight transcriptions to finish. No-op when
    // transcription is off. The queue is serial so total drain time is
    // sum(chunk_transcription_time) -- can be on the order of tens of seconds
    // for a long meeting; that's the right behaviour because exiting early
    // would orphan the .txt files we promised to produce.
    try {
      trace('shutdown', 'await drainTranscriptions()');
      await recorder.drainTranscriptions();
      trace('shutdown', 'drainTranscriptions() settled');
    } catch (_) { /* drain() does not reject */ }
    process.exit(0);
  };

  const wireShutdown = (reason) => {
    shutdown(reason).catch((err) => {
      console.error('Shutdown error:', err);
      process.exit(1);
    });
  };

  process.on('SIGINT', () => wireShutdown('Stopping...'));
  process.on('SIGTERM', () => wireShutdown('Stopping...'));

  if (durationSeconds !== null) {
    const label = command === 'idle' ? 'Listening' : 'Recording';
    console.log(`${label} for ${durationSeconds}s. Press Ctrl+C to stop early.`);
    durationTimer = setTimeout(() => wireShutdown(`Reached ${durationSeconds}s, stopping.`), durationSeconds * 1000);
  }

  return 0;
}

if (require.main === module) {
  main(process.argv)
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error('Unexpected error:', err);
      process.exit(2);
    });
}

module.exports = {
  main,
  printHelp,
  runDevices,
  runListen,
  runTranscribe,
  parseRecordArgs,
  parseIdleArgs,
  parseListenArgs,
  parseTranscribeArgs,
  parseSubcommandArgs,
  applyRecordAutoTranscribe,
  resolveIdleChunkKnobs,
  resolveTranscribeThreads,
  resolveNoSpeechThreshold,
  resolveEntropyThreshold,
  WHISPER_MAX_AUTO_THREADS,
  WHISPER_NO_SPEECH_DEFAULT,
  WHISPER_ENTROPY_DEFAULT,
  trace,
  enableTraceFromCli,
};
