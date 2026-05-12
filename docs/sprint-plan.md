# Sprint Plan — Phase 3 Track A: Working Audio

Goal of this track: take the AudioRecorder from "code that parses and tests pass with mocks" to **"I can plug in a mic, run a command, and (1) see live audio levels, then (2) save a playable WAV file"** — verified on the actual Windows machine this project lives on.

Sprints 1–9 built the scaffolding and stabilized it. Nothing has yet been validated against real hardware. The mini-sprints below are intentionally tiny so each one ends in a runnable, verifiable artifact rather than weeks of integrated work.

## Ordering principle

Listening before recording, for three reasons:
1. Listening proves the input device works without committing files to disk.
2. Listening surfaces auth/dep problems (sox missing, device permission, wrong default input) cheaply.
3. Recording is mechanically a superset of listening — same pipeline, plus a destination file and a finalization step.

## Constraint inventory (known before we start)

- `node-record-lpcm16` v1.0.1 on Windows shells out to **sox** (`sox.exe`). Sox is not bundled by npm; it must be on `PATH`.
- The current `start()` pipes the raw stream from `recorder.record()` straight into a file with no `audioType` set. This produces **raw PCM**, not a playable WAV file. That has to change before recording is "working".
- The current `idleListen()` appends all silence-delimited chunks to a single file path with `flags: 'a'`. Even after the WAV fix, this would concatenate multiple WAV headers into one file. Rolling per-chunk filenames are required.
- Sox on Windows historically installs without registering itself on `PATH`. Users will likely need to add `C:\Program Files (x86)\sox-X.Y.Z\` to `PATH` themselves.

## Sprint map

### Phase 3A — Listening pipeline (prove input)

| Sprint | Title | Outcome | Status |
|---|---|---|---|
| MS-1 | Sox dependency probe | `npm run audio:check` reports sox version or a clean install message | ✅ |
| MS-2 | Device enumeration | `node src/index.js devices` lists detected audio inputs | ✅ |
| MS-3 | Live level meter | `node src/index.js listen` prints a live peak-amplitude bar | ✅ |

### Phase 3B — Recording pipeline (prove output)

| Sprint | Title | Outcome | Status |
|---|---|---|---|
| MS-4 | WAV output from `start()` | `node src/index.js record out.wav` + Ctrl+C produces a playable WAV | ✅ |
| MS-4.5 | WAV header fixup | RIFF/data chunk sizes reflect actual file size, not sox's ~2 GiB placeholder | ✅ |
| MS-5 | Fixed-duration record | `record --duration 5 out.wav` stops cleanly after ~5 s | ✅ |
| MS-5.1 | Sox-side duration trim (optional) | Captured audio length matches `--duration` to within 100 ms (compensates the ~400 ms Windows startup latency) | optional |
| MS-6 | Rolling idle chunks | `idle <dir>` writes timestamped per-silence WAV files in `<dir>` | ✅ |
| MS-7 | Whisper-aligned defaults | Default capture is 16 kHz mono 16-bit signed PCM in WAV | ✅ |
| MS-8 | Chunk metadata sidecars | Each idle-mode WAV gets a sidecar `.json` with start, end, peak | ✅ |

Eight mini-sprints; each should be ~30–90 minutes of work. After MS-3 you can demo "listening". After MS-4 you can demo "recording". After MS-8 the audio capture pipeline is ready to hand off to a transcription sprint.

---

## Mini-sprint details

### MS-1 — Sox dependency probe

- **Goal:** detect whether sox is callable from this Node process and surface a friendly install message if not.
- **Touches:** new `tools/check-audio-deps.js`, new `npm run audio:check` script in `package.json`, README install section appended.
- **Steps:**
  1. Spawn `sox --version` via `child_process.spawn`.
  2. Print version + resolved path on success.
  3. On `ENOENT`, print install hints for Windows (winget, chocolatey, manual `sourceforge.net/projects/sox/files/sox/` link) and exit with a non-zero code.
- **Validation:** run on this machine before and after installing sox. Both code paths produce useful output.
- **Acceptance criteria:** with sox installed, `npm run audio:check` exits 0 and shows the version. Without, exits non-zero and tells the user what to do.
- **Rollback:** delete two new files and the script entry; the rest of the project is unaffected.
- **Risk:** sox install may require admin rights and `PATH` edit; document this honestly.

### MS-2 — Device enumeration

- **Goal:** list audio input devices visible to sox.
- **Touches:** `src/index.js` (new `devices` subcommand), no library changes.
- **Steps:**
  1. Add `devices` to the CLI dispatch.
  2. Shell out to `sox -V6 -n -t waveaudio "?" -n` (or platform-appropriate query) to enumerate Windows WaveAudio devices, parse stderr.
  3. Print a numbered list with name and any reported sample-rate hint.
- **Validation:** runs cleanly on this machine; output includes the default input.
- **Acceptance criteria:** at least one device listed when a microphone is connected; exit 0.
- **Rollback:** remove the new subcommand block.
- **Risk:** sox device-listing syntax differs across builds; if the chosen incantation fails, fall back to printing sox's raw `-V6` diagnostics.

### MS-3 — Live level meter

- **Goal:** prove the audio input pipeline end-to-end without writing any file, by displaying live peak amplitude.
- **Touches:** `src/audioRecorder.js` (new `listen(onSample)` method that yields PCM buffers but writes no file), `src/index.js` (new `listen` subcommand), tests for the new method.
- **Steps:**
  1. Add `AudioRecorder.listen(handler)` that calls `recorder.record(this.options)`, attaches `stream().on('data', handler)`, and returns a `stop` function.
  2. CLI computes peak amplitude per chunk: `Math.max(...sampleValues)` (interpret as 16-bit signed little-endian).
  3. Render a 40-column ASCII bar, throttled to every 100 ms.
  4. Ctrl+C cleanly stops the listen stream.
- **Validation:** run `node src/index.js listen` and clap — the bar visibly responds.
- **Acceptance criteria:** non-zero levels observed on at least one audio event; Ctrl+C exits cleanly without sox processes left behind (verify with Task Manager / `Get-Process sox`).
- **Rollback:** revert the new method + subcommand. Existing `start`/`idleListen`/`stop` untouched.
- **Risk:** if `node-record-lpcm16` emits in a different endianness or width than expected on Windows, the meter will look stuck or saturated. Mitigate by also printing raw min/max for one chunk per second during debugging.

---

### MS-4 — WAV output from `start()`

- **Goal:** make `record <file>` produce a real playable WAV.
- **Touches:** `src/audioRecorder.js` (pass `audioType: 'wav'` and let sox write the file rather than piping raw PCM to a Node stream), tests adjusted.
- **Steps:**
  1. Change `start()` to pass `audioType: 'wav'` to `recorder.record()`. Confirm in node-record-lpcm16 source that this routes through sox's wav writer with proper RIFF header.
  2. Decide: keep piping to `fileStream` (sox already wrote header on stream start) **or** have sox write the file directly (simpler but loses Node-level flush control). Pick the simpler one (sox writes to its own stdout, Node pipes to file).
  3. Update tests: `fs.createWriteStream` still mocked; assert sox is invoked with `audioType: 'wav'`.
- **Validation:** record ~3 s, open the file in Windows Media Player / Groove, hear playback.
- **Acceptance criteria:** the WAV file's first 4 bytes are `RIFF`; `data` chunk size > 0; audible content on playback.
- **Rollback:** revert the option change; the file goes back to raw PCM (broken-but-known state).
- **Risk:** Ctrl+C may truncate the WAV before sox writes the data-size header, leaving an invalid file. MS-5 partly addresses this by using sox's own duration termination instead of SIGINT.

### MS-5 — Fixed-duration record (Completed in Sprint 16)

- **Goal:** `record --duration 5 out.wav` runs for ~5 seconds and exits cleanly without Ctrl+C.
- **Touches:** `src/index.js` (new `parseRecordArgs` helper + unified `shutdown(reason)`), `tests/parseRecordArgs.test.js`.
- **Outcome:** flag works in both `--duration N` and `--duration=N` form, before or after the output path. CLI exits 0 after the timer fires; the WAV header fixup (MS-4.5) runs inside a 150 ms shutdown grace.
- **Realized acceptance criteria:** process exits 0; file is a valid RIFF/WAVE WAV with correct chunk sizes; audio duration is approximately `duration - 0.4 s` because of sox's Windows startup latency.
- **Known slippage:** sox spends ~400 ms initializing waveaudio before the first sample arrives, so a `--duration 5` request yields ~4.6 s of captured audio. Honest behavior; MS-5.1 (optional, below) is the proper fix if precision matters.

### MS-5.1 — Sox-side duration trim (optional)

- **Goal:** make captured audio length match `--duration` to within ~100 ms by terminating the recording inside sox rather than from Node.
- **Touches:** `src/recorderPatch.js` (accept `durationSeconds` in `options`, append `trim 0 <n>` to the sox arg list), `src/audioRecorder.js` (pass `durationSeconds` through), `src/index.js` (already plumbs duration to the recorder), tests.
- **Steps:**
  1. Extend the patched recorder to consume `options.durationSeconds` and append `trim 0 <n>` to the sox effect chain.
  2. When sox exits naturally at the end of the trim, the existing `'end'`/`'close'` plumbing closes the file and the MS-4.5 header fixup runs as it does today.
  3. Keep the Node-side timer as a watchdog (e.g. `(durationSeconds + 1) * 1000` ms) so a misbehaving sox can still be killed.
- **Validation:** `record --duration 5 out.wav` → `sox out.wav -n stat` reports Length between 4.95 s and 5.05 s.
- **Acceptance criteria:** captured length within ±100 ms of requested, on three consecutive runs.
- **Rollback:** drop the `trim` append + option; behavior reverts to the MS-5 ~0.4 s slippage.
- **Risk:** the trim effect runs *after* resampling, so it operates on the requested sample rate, not the device's native rate; should be a non-issue at 16 kHz but worth confirming on first run.

### MS-6 — Rolling idle chunks (Completed in Sprint 17)

- **Goal:** replace the broken single-file append behavior of `idleListen` with one WAV file per silence-delimited chunk, named with a sortable timestamp.
- **Outcome:** `idleListen(directory)` creates the directory, writes `chunk-YYYYMMDD-HHMMSS-mmm.wav` per chunk, finalizes each chunk's WAV header on rotation, and auto-deletes empty placeholders. CLI is `node src/index.js idle <directory>`.
- **Realized acceptance criteria:** structural validity of every produced chunk verified via `tools/smoke-idle.js` (header walk + `sox -n stat`); 0 chunks in a quiet room is a valid outcome (placeholder auto-deleted).
- **Lessons captured in `docs/sprint-log.md` Sprint 17:** missing `endOnSilence: true` + listening on the Recording instead of its stream were both real-hardware-only bugs that didn't show up in mock-only tests. Added a `_attachFinalize` shared helper to eliminate duplicate WAV-header finalization between `idleListen` and `stop()`.

### MS-7 — Whisper-aligned defaults (Completed in Sprint 18)

- **Goal:** capture format is 16 kHz mono 16-bit signed PCM in WAV by default, and the contract is enforceable from a single source of truth.
- **Outcome:** `WHISPER_AUDIO_FORMAT = { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' }` exported (frozen) from `src/audioRecorder.js`. Constructor defaults spread it. `src/recorderPatch.js` honors `bitDepth`/`encoding` options. `tools/smoke-record.js` parses the WAV `fmt ` chunk and asserts every field matches the contract.
- **Realized acceptance criteria:** smoke-record reports `formatCode: 1 (PCM), channels: 1, sampleRate: 16000, byteRate: 32000, blockAlign: 2, bitsPerSample: 16`, and `whisperFormatMatch.ok: true`.

### MS-8 — Chunk metadata sidecars (Completed in Sprint 19)

- **Goal:** for each idle-mode WAV file, write a companion `.json` capturing chunk start, end, audio-derived duration, peak amplitude, peak dBFS, byte count, and audio format.
- **Outcome:** schema v1 exported from `src/chunkSidecar.js`. Reuses MS-3's `peak16LE` via a new `PeakAccumulator` that skips the 44-byte WAV header prefix. Wired into `idleListen` via the existing `_attachFinalize` path so the WAV header fixup and the sidecar write happen in the same `'close'` callback.
- **Realized acceptance criteria:** end-to-end smoke shows `durationMs` matches `sox stat`'s reported length to the millisecond; peak agrees with sox's max amplitude within rounding; every produced WAV has a sidecar with all required fields and `version === 1`.

---

## Cross-cutting checklist for every mini-sprint

Per `.instructions.md` workflow rules:

1. `git status` clean before starting; pull if anything sneaks onto origin.
2. Smallest useful diff; no unrelated refactors.
3. `npm test` and (where the sprint adds binary tooling) the new validation command both pass.
4. Update `docs/sprint-log.md` with what / why / files / known limitations.
5. `npm run docs:html` to regenerate HTML mirrors.
6. Atomic commit named `[sprint-N] <concise>`.
7. Push to `origin/develop` per the as-directed-push rule, after local validation.

## Explicitly out of scope for this track

The following are **not** part of the eight mini-sprints above. Each is its own future track:

- Whisper transcription (chunked or otherwise)
- Local summarization (any tier of the hour → quarter hierarchy)
- Markdown persistence of transcripts
- Search index over summaries
- Heat/trend analysis
- GPU acceleration of any kind
- Human review UI
- Rolling audio deletion after transcript+summary persistence

These will be planned in their own dedicated sprint-plan tracks once Phase 3 Track A is green.

## Definition of "done" for the whole track

The track is complete when, on this Windows machine, **all of the following are true with no extra setup beyond what the README documents**:

- `npm run audio:check` reports a sox version.
- `node src/index.js devices` lists at least the default mic.
- `node src/index.js listen` shows a visibly-changing level bar that responds to ambient sound.
- `node src/index.js record --duration 5 demo.wav` produces a 5-second playable WAV.
- `node src/index.js idle ./recordings/` produces one valid WAV (plus matching JSON sidecar) per silence-delimited vocal burst.
- `npm test` is green and tests assert the new lifecycle invariants (Whisper-aligned defaults, sidecar shape, no double-start).
