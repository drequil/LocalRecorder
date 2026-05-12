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
| MS-9 | CLI knobs for idle / listen / record | `--threshold`, `--silence`, `--device`, `--max-chunk-seconds` | ✅ |
| MS-10 | Structured output paths + idle duration | `--name`, `--root`, `--duration` for idle; record-mode sidecars | ✅ |

Ten mini-sprints; each should be ~30–90 minutes of work. After MS-3 you can demo "listening". After MS-4 you can demo "recording". After MS-8 the audio capture pipeline is ready to hand off to a transcription sprint. MS-9 and MS-10 added CLI ergonomics and structured output that the user surfaced in the post-MS-8 walkthrough.

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

### MS-9 — CLI knobs for idle / listen / record (Completed in Sprint 20)

- **Goal:** expose every per-run audio capture knob through CLI flags so tuning idle mode for a noisy office or picking a non-default microphone doesn't require a source edit.
- **Outcome:** generic `parseSubcommandArgs(args, flagSpec)` helper with a `COERCERS` table; `RECORD_FLAGS`, `IDLE_FLAGS`, `LISTEN_FLAGS` schemas; new `--threshold`, `--silence`, `--max-chunk-seconds` (idle) and `--device` (all three). `maxChunkSeconds` plumbs through `AudioRecorder` and arms a per-chunk timer that kills sox to force a rotation when silence detection alone isn't doing the job.
- **Realized acceptance criteria:** running `idle <tmpdir> --threshold 0.01 --max-chunk-seconds 3` for 8 s produces 4 complete chunk WAV+JSON pairs at ~3 s wall-clock intervals; sidecar fields are preserved when the chunk ends via the timer instead of natural silence detection.

### MS-10 — Structured output paths + idle duration (Completed in Sprint 21)

- **Goal:** stop dumping recordings into whichever cwd the user happened to be in; give them a named-session sub-folder per recording; let `idle` also stop itself after `--duration N`; write a sidecar for `record` mode too.
- **Outcome:** new `src/recordingPaths.js` resolver (`resolveRecordPath` / `resolveIdleDirectory`) produces `recordings/<name-or-date>/<base>-<ts>.wav` paths. CLI gains `--name` and `--root` for both `record` and `idle`, plus `--duration` for `idle`. `AudioRecorder.start()` now accepts an options object with `writeSidecar` (default `true`) and emits a companion JSON via the same `_attachFinalize` path that idle uses. Positional `<out.wav>` / `<directory>` args are now optional — legacy invocations still work verbatim. Shutdown grace bumped from 150 ms to 250 ms to absorb the extra sidecar write.
- **Realized acceptance criteria:** `node src/index.js idle --name meeting --duration 3600 --threshold 0.5 --silence 20` runs unattended for up to an hour, writing chunk WAV+JSON pairs into `recordings/meeting/`. Verified end-to-end with a `--duration 5` quick run: WAV (147 KB) and sidecar (`durationMs: 4607`, `peak: 0.0042`) both materialize in the resolved structured directory. `npm test` reports 119/119 passing including 12 new `tests/recordingPaths.test.js` cases.

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
- `node src/index.js record --duration 5 demo.wav` produces a 5-second playable WAV (with companion sidecar JSON).
- `node src/index.js idle --name <label> --duration <seconds>` produces one valid WAV (plus matching JSON sidecar) per silence-delimited vocal burst, under `./recordings/<label>/`.
- `npm test` is green and tests assert the new lifecycle invariants (Whisper-aligned defaults, sidecar shape, no double-start).

---

# Sprint Plan — Phase 4 Track: Transcription

Goal of this track: take the captured WAV+sidecar pairs from Phase 3 and produce **live, human-readable transcripts** alongside them — same "small atomic sprints, each ends in a runnable artifact" cadence. The endgame is the user speaking into the mic and watching a `.md` file populate in real time as idle-mode rotates chunks.

## Ordering principle

Same shape as Phase 3A/3B: prove the foundation before integrating.
1. Probe the binary (T-1).
2. Transcribe one file end-to-end via the CLI (T-2) — no idle integration yet.
3. Wire transcription into the rotation lifecycle (T-3).
4. Persist transcripts as human-reviewable markdown (T-4).
5. Add the resilience knobs (T-5) — retries, error handling, skip empty/below-threshold chunks.
6. Close the loop with an end-to-end demo (T-6).

## Constraint inventory (known before we start)

- `whisper.cpp` ships a CLI binary whose name varies by install: `whisper-cli` (modern), `whisper` (some package managers), `main` (legacy). T-1 normalises detection across all three.
- The CLI also needs a model file (e.g. `ggml-base.en.bin`); models are 75 MB–3 GB depending on size. The user will need to download one before T-2 can run.
- Transcription is CPU-bound and chunky. A 30-second WAV on `base.en` takes ~5–15 s on a modern laptop CPU. T-3 must not block the rotation pipeline, and T-5 must handle the case where transcription falls behind capture.
- whisper.cpp does not implement `--version`. T-1's banner heuristic is the closest substitute and is intentionally lenient.

## Sprint map

### Phase 4 — Transcription

| Sprint | Title | Outcome | Status |
|---|---|---|---|
| T-1 | Whisper.cpp dependency probe | `npm run transcribe:check` reports the resolved binary or a clean install message | ✅ |
| T-2 | Transcribe a known-good WAV via CLI | `node src/index.js transcribe <file>` prints text from a single WAV | ✅ |
| T-3 | Wire transcription into idle rotation | Each rotated chunk is auto-transcribed; transcript stored next to the WAV | ⏳ |
| T-4 | Per-chunk markdown persistence | `.md` per chunk combines transcript + sidecar metadata for human review | ⏳ |
| T-5 | Resilience: retries, skip empty, error handling | Transcription survives bad chunks, slow runs, and silent rooms | ⏳ |
| T-6 | End-to-end "speak → see markdown update" demo | Documented full run from `idle` start to live `.md` updates | ⏳ |

Six sprints; ~30–90 minutes each. After T-2 you can demo "transcribe a file". After T-4 the per-chunk pipeline is feature-complete. T-5 hardens it. T-6 is the milestone the user actually asked for.

---

## Sprint details

### T-1 — Whisper.cpp dependency probe (Completed in Sprint 22)

- **Goal:** detect whether a whisper.cpp CLI is callable from this Node process and surface a friendly install message if not.
- **Outcome:** `tools/check-transcribe-deps.js` probes three candidate binary names in order (`whisper-cli`, `whisper`, `main`) via `spawnSync(name, ['--help'])`. First one that exits 0 wins. ENOENT moves on; non-ENOENT failures are preserved in diagnostics. New `npm run transcribe:check` script. Per-platform install hints (winget unavailable for Windows → GitHub releases; `brew install whisper-cpp` on macOS; build-from-source instructions on Linux). README gains a "Transcription Prerequisites" section flagged "upcoming — not yet required by the CLI".
- **Realized acceptance criteria:** without whisper.cpp installed, `node tools/check-transcribe-deps.js` exits 1 and prints the Windows install hint block (verified on this machine). With whisper.cpp installed, the probe will print the resolved binary path and any banner-derived version. `npm test` reports 137/137 passing across 11 suites (119 → 137 with 18 new tests across `parseWhisperHelp`, `pickCandidateBinary`, `findOnPath`, and `printInstallHints`).

### T-2 — Transcribe a known-good WAV via CLI (Completed in Sprint 23)

- **Goal:** prove the transcription path end-to-end on a single WAV file, with no idle integration. `node src/index.js transcribe <file.wav>` reads the WAV, invokes whisper.cpp with a sensible default model, and prints the transcript to stdout.
- **Outcome:** new `src/transcribe.js` exposes `transcribeFile({ wav, model, binary?, spawnFn?, resolveBinaryFn?, fsImpl? })` plus pure helpers (`expectedTxtPaths`, `isWavFile`, `buildWhisperArgs`, `resolveBinary`, `readTranscriptFile`). Spawns `whisper-cli --no-prints --output-txt -m <model> -f <wav>` and reads whichever `.txt` sibling whisper.cpp wrote — `expectedTxtPaths` returns both the modern strip-ext (`<basename>.txt`) and legacy append (`<wav>.txt`) candidates so the wrapper tolerates either convention. T-1's `pickCandidateBinary` is re-used for binary discovery (no duplicated lookup logic). `transcribe <file.wav>` subcommand in `src/index.js` with `--model <path>` (default `./models/ggml-base.en.bin`) and `--json` flags. JSON mode pulls a banner-derived `version` via the T-1 `probeBinary` + `parseWhisperHelp` helpers.
- **Realized acceptance criteria:** on this Windows machine the recorded `whisper-cli` build actually writes the **legacy** filename (`hello.wav.txt`), not the modern `<basename>.txt` — the defensive two-candidate lookup quietly handled it on the first real run. A 5-second ambient-room WAV (peak 0.032 / -29.9 dBFS) transcribed to an empty string in 2.6 s (~57% of realtime on `base.en` with the Win32 BLAS build); whisper.cpp correctly emitted no transcript for non-speech audio rather than hallucinating one. Pipeline exits 0; CLI error paths (missing binary, missing model, missing/non-WAV input, non-zero whisper exit, empty .txt output, spawn ENOENT) are all covered by the 8-describe-block `tests/transcribe.test.js` plus 11-case `tests/parseTranscribeArgs.test.js`. **Not yet validated:** transcript fidelity against actual spoken words — that needs a user-in-the-loop record-then-transcribe run with someone speaking into the mic. Honest deferred item, tracked at the bottom of the Sprint 23 log entry.
- **Known limitations:** transcribe is a blocking spawn; a 30-second WAV ties up the CPU for ~15 s. Acceptable for T-2's single-file use case; T-3 will introduce queue + serial processing for the idle integration. The `version` field in `--json` output is `null` on the Win32 build whose `--help` banner contains no semver token (same shape as the T-1 probe output); `versionLabel` carries the raw banner line so downstream consumers have something to log.

### T-3 — Wire transcription into idle rotation

- **Goal:** every chunk produced by `idle` gets auto-transcribed after its WAV header is finalised. Transcript text is stored either in the existing sidecar JSON (extending the schema to v2) or as a sibling `.txt` (parallel to the WAV).
- **Touches:** `src/audioRecorder.js` (extend `_attachFinalize` to call into a new transcription hook), `src/transcribe.js` (already present from T-2; add a queue if needed), `src/chunkSidecar.js` (potential schema bump), tests.
- **Decision to make:** sibling `.txt` vs sidecar extension. Lean toward **sibling `.txt`** because: (1) keeps the schema-v1 sidecar untouched, (2) matches whisper.cpp's own `--output-txt` convention, (3) makes failure modes orthogonal — a missing `.txt` means "transcription pending/failed", a complete sidecar means "capture metadata is fine regardless". Justify the choice inline in the sprint log when the sprint runs.
- **Steps:**
  1. Add a `transcribe: true` constructor option to `AudioRecorder` (default off until enabled at the CLI level).
  2. When `_attachFinalize` runs its `'close'` callback, if `transcribe` is on, enqueue a transcription job for the just-finalised WAV.
  3. Run jobs serially via a tiny in-memory queue so two long chunks don't compete for CPU.
  4. Write `<chunk>.txt` on success; emit a single-line `[transcribed]` log; on failure, leave the WAV+sidecar in place and log the error.
- **Validation:** `node src/index.js idle --name t3-demo --duration 20 --transcribe` produces 1–3 chunks; each chunk has a non-empty `.txt` next to the `.wav` and `.json`.
- **Acceptance criteria:** for non-empty chunks, a `.txt` materialises within ~10× chunk-duration seconds of the chunk closing; for empty chunks, no `.txt` is produced (or it's an empty file, depending on the T-5 design).
- **Rollback:** revert the `transcribe` flag — capture still works exactly as it does today.
- **Risk:** transcription falling behind capture in a long monologue. T-5 owns the fix; T-3 just observes the behavior honestly.

### T-4 — Per-chunk markdown persistence

- **Goal:** alongside each chunk produce a `.md` file that combines the transcript with the sidecar metadata in a human-reviewable form. This is the artifact a user actually opens after a meeting.
- **Touches:** new `src/chunkMarkdown.js` (pure formatter: `(sidecar, transcript) → markdown string`), `src/audioRecorder.js` (write `.md` in the same finalize path after the `.txt` lands), tests in `tests/chunkMarkdown.test.js`.
- **Steps:**
  1. Design a minimal markdown shape: `# <chunk timestamp>` heading, a small key/value block for `durationMs`, `peakDb`, `bytes`, and the transcript verbatim. Cross-link to the WAV and JSON sidecar via relative paths.
  2. Make the formatter pure so the markdown shape can be unit-tested without sox/whisper.
  3. Write `.md` after `.txt`; if `.txt` is missing (transcription failed), still write a `.md` stub with the sidecar metadata and a `_transcription unavailable_` placeholder. This keeps the human-review surface complete even when transcription fails.
- **Validation:** open one produced `.md` in any markdown viewer; confirm the transcript and metadata are both present and readable.
- **Acceptance criteria:** every WAV has a matching `.md` after the chunk closes. The `.md` is valid GFM (no broken tables, no unbalanced fences).
- **Rollback:** stop writing `.md`; the JSON + WAV + TXT trio still works.
- **Risk:** schema drift — if T-3 chose sidecar-extension over sibling-`.txt`, the formatter needs to read the transcript from the sidecar instead of a sibling file. Plan for both shapes in the formatter signature.

### T-5 — Resilience: retries, skip empty, error handling

- **Goal:** transcription survives bad inputs and slow runs without taking the capture pipeline down. The user should be able to leave `idle --transcribe` running for an hour and not have a single failed chunk corrupt the rest of the session.
- **Touches:** `src/transcribe.js` (add retry-with-backoff for transient failures), `src/audioRecorder.js` (peak gating: skip transcription entirely when `peak < threshold`), tests.
- **Steps:**
  1. **Skip-empty rule:** when a chunk's sidecar `peak` is below `transcribeMinPeak` (default ~0.005, ~−46 dBFS — well above typical room hum), do not enqueue it. Write a `.md` stub with `_skipped: peak below threshold_` so the user can see the gap is intentional.
  2. **Retry rule:** wrap each whisper.cpp invocation in a single retry on non-zero exit (one retry, no backoff — transcription is deterministic; if it fails twice it will fail forever). Log both attempts.
  3. **Backpressure:** if the queue length exceeds N (default 5), log a warning. Optionally, on overflow, drop the oldest non-transcribed chunk's job and keep its WAV+JSON+MD-stub for later batch processing.
  4. New CLI flags: `--transcribe-min-peak <p>`, `--transcribe-queue-max <n>`.
- **Validation:** induce three failure modes — (a) a silent chunk (peak below threshold), (b) a corrupted WAV (truncate the data chunk), (c) a missing model — and confirm the capture pipeline keeps running with appropriate `.md` stubs.
- **Acceptance criteria:** zero capture chunks are lost regardless of transcription failures. Every WAV either has a real transcript or a `.md` stub explaining why.
- **Rollback:** revert the new flags; T-3/T-4 behavior persists, just less defensively.
- **Risk:** the peak threshold needs tuning per environment. Make it configurable from day one (already required by the flag list) and document the tuning procedure in the sprint log.

### T-6 — End-to-end demo: speak → see markdown update

- **Goal:** the milestone. The user runs one command, speaks into the mic, and watches `.md` files appear in real time as chunks rotate. This is the proof that Phase 4 produces something useful to the user's stated goal.
- **Touches:** mostly documentation — `docs/sprint-log.md` records the run; `README.md` gains a "Live demo" section with the canonical command. Code changes only if T-1..T-5 expose any rough edges during the run.
- **Steps:**
  1. Pick a model: `ggml-base.en.bin` is the default sweet spot (smaller = faster, larger = better accuracy). Verify it exists or download it first.
  2. Run `node src/index.js idle --name t6-demo --transcribe --threshold 0.5 --silence 2 --duration 60` and speak in 2–3 sentences with pauses.
  3. While it runs, observe `recordings/t6-demo/`: each silence pause should produce a WAV, then a JSON, then a TXT, then a MD within ~10 s.
  4. Open one of the `.md` files; verify the transcript is human-readable.
  5. Capture the full session output (CLI logs + directory listing + one example `.md`) in the sprint log.
- **Validation:** the captured session log shows at least 3 chunks transcribed end-to-end with the `.md` artifacts present. No leftover sox/whisper processes after Ctrl+C (`Get-Process sox`, `Get-Process whisper-cli` both empty).
- **Acceptance criteria:** the user can read the meeting transcript directly from `recordings/t6-demo/*.md` without consulting any tool other than their text editor.
- **Rollback:** none — this is documentation. If the run reveals a bug, fix it in a T-6.x patch and re-run.
- **Risk:** transcription accuracy on `base.en` is not great. The user may want `small.en` or `medium.en` for real meetings; document the trade-off table in the README.

---

## Cross-cutting checklist for every Phase 4 sprint

Same as Phase 3A:

1. `git status` clean before starting; pull if anything sneaks onto origin.
2. Smallest useful diff; no unrelated refactors.
3. `npm test` and (where the sprint adds binary tooling) the new validation command both pass.
4. Update `docs/sprint-log.md` with what / why / files / known limitations.
5. `npm run docs:html` to regenerate HTML mirrors.
6. Atomic commit named `[sprint-N] <concise>` or `T-X: <concise>`.
7. Push to `origin/develop` per the as-directed-push rule, after local validation.

## Explicitly out of scope for Phase 4

These belong to later tracks:

- Local summarization (hour → day → week → quarter hierarchy)
- Search index over transcripts
- Heat/trend analysis
- GPU acceleration of whisper.cpp (separate sprint once the CPU baseline is honest)
- Rolling audio deletion after transcript persistence (a Phase 5 cleanup track)
- Human review UI

## Definition of "done" for the Phase 4 track

The track is complete when, on this Windows machine:

- `npm run transcribe:check` reports a whisper.cpp version.
- `node src/index.js transcribe <wav>` produces a non-empty transcript for a non-silent WAV.
- `node src/index.js idle --name <label> --transcribe --duration <seconds>` produces, for each non-silent chunk, a `.wav`, `.json`, `.txt`, and `.md` quartet in `./recordings/<label>/`.
- Silent / sub-threshold chunks produce a `.md` stub explaining why they were skipped, instead of leaving the user wondering.
- `npm test` is green and asserts the new transcription invariants (probe shape, formatter output, skip-empty rule).
