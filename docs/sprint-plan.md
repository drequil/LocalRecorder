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

| Sprint | Title | Outcome |
|---|---|---|
| MS-1 | Sox dependency probe | `npm run audio:check` reports sox version or a clean install message |
| MS-2 | Device enumeration | `node src/index.js devices` lists detected audio inputs |
| MS-3 | Live level meter | `node src/index.js listen` prints a live peak-amplitude bar |

### Phase 3B — Recording pipeline (prove output)

| Sprint | Title | Outcome |
|---|---|---|
| MS-4 | WAV output from `start()` | `node src/index.js record out.wav` + Ctrl+C produces a playable WAV |
| MS-5 | Fixed-duration record | `record --duration 5 out.wav` writes exactly ~5 s of audio |
| MS-6 | Rolling idle chunks | `idle <dir>` writes timestamped per-silence WAV files in `<dir>` |
| MS-7 | Whisper-aligned defaults | Default capture is 16 kHz mono 16-bit signed PCM in WAV |
| MS-8 | Chunk metadata sidecars | Each idle-mode WAV gets a sidecar `.json` with start, end, peak |

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

### MS-5 — Fixed-duration record

- **Goal:** `record --duration 5 out.wav` produces exactly ~5 seconds of valid WAV without needing Ctrl+C.
- **Touches:** `src/index.js` (parse `--duration`), `src/audioRecorder.js` (optional `durationSeconds` in options or a setTimeout-driven stop in the CLI), tests.
- **Steps:**
  1. CLI parses `--duration <n>` (positive number).
  2. After `recorder.start(outputPath)`, set `setTimeout(() => { recorder.stop(); process.exit(0); }, n * 1000)`.
  3. Test that the CLI dispatch handles `--duration` argument shape (unit-level only; no real recording).
- **Validation:** `record --duration 5 out.wav` produces a file whose reported duration is between 4.8 and 5.5 seconds (check via sox: `sox out.wav -n stat`).
- **Acceptance criteria:** duration in range, file playable, process exits 0.
- **Rollback:** drop the flag and the setTimeout block.
- **Risk:** sox latency on first sample may make short durations (≤1 s) record less than expected; document the lower bound.

### MS-6 — Rolling idle chunks

- **Goal:** replace the broken single-file append behavior of `idleListen` with one WAV file per silence-delimited chunk, named with an ISO timestamp.
- **Touches:** `src/audioRecorder.js` (`idleListen(directory, options)` signature change — accepts a directory, generates per-chunk filenames internally), `src/index.js`, tests adjusted.
- **Steps:**
  1. Change `idleListen(outputPath)` to `idleListen(directory)`.
  2. For each chunk, build a filename `chunk-YYYYMMDD-HHMMSS.wav` (UTC; padded with `Date#toISOString` slicing).
  3. Pass `audioType: 'wav'` per chunk (each chunk is its own complete WAV).
  4. Update CLI `idle <directory>` accordingly.
  5. Update existing idleListen tests; the test assertion that previously expected `flags: 'a'` becomes "createWriteStream called with a chunk-*.wav path inside the directory".
- **Validation:** run `idle ./recordings/`, speak, pause, speak again. Two or more WAV files appear, each playable.
- **Acceptance criteria:** at least 2 files produced from at least 2 distinct vocal bursts; no duplicate filenames; no leftover sox processes after Ctrl+C.
- **Rollback:** restore single-file `outputPath` signature; the broken-but-stable Sprint 9 state is one revert away.
- **Risk:** timestamp collisions if two chunks start within the same second; mitigate by appending a counter on collision.

### MS-7 — Whisper-aligned defaults

- **Goal:** capture format defaults to 16 kHz mono 16-bit signed PCM in WAV (`bitwidth: 16`, `channels: 1`, `sampleRate: 16000`, `audioType: 'wav'`, `encoding: 'signed-integer'`), so Whisper consumes recordings with no resampling.
- **Touches:** `src/audioRecorder.js` default options block, tests.
- **Steps:**
  1. Update default options object.
  2. Add a test that asserts the defaults are exactly the Whisper-compatible set.
- **Validation:** record a 2-second sample, run `sox out.wav -n stat` and confirm the reported rate/channels/depth.
- **Acceptance criteria:** sox stat reports 16000 Hz, 1 channel, 16-bit signed.
- **Rollback:** revert the defaults block.
- **Risk:** none of significance; this is metadata.

### MS-8 — Chunk metadata sidecars

- **Goal:** for each idle-mode WAV file, write a companion `.json` capturing start ISO time, end ISO time, duration ms, and peak amplitude.
- **Touches:** `src/audioRecorder.js` (instrument the chunk lifecycle), tests, optional new helper module.
- **Steps:**
  1. On chunk start, record `chunkStart = new Date()`.
  2. Tap the audio stream to compute running peak (reuse code from MS-3).
  3. On chunk end, write `<chunk-name>.json` with `{ start, end, durationMs, peak }`.
  4. Tests assert sidecar shape using the mock `fs.writeFile`/`createWriteStream`.
- **Validation:** record an idle session, open one of the JSON sidecars, confirm values look sane (duration matches the WAV's, peak between 0 and 1).
- **Acceptance criteria:** every WAV has a matching JSON; durations agree within 100 ms; peak ∈ [0,1].
- **Rollback:** remove the instrumentation; WAVs continue to work standalone.
- **Risk:** synchronous JSON writes on every chunk could stutter under heavy load. Move to async writes if observed; not a concern at the volumes expected here.

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
