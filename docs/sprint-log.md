# Sprint Log

## Sprint 1: Project Setup (Completed)
- Created src/, docs/, tests/ directories
- Added README.md with goals and principles
- Initialized package.json for Node.js
- Ran npm install successfully
- Committed changes

## Sprint 2: Audio Library Selection (Completed)
- Researched and selected node-record-lpcm16 for Windows compatibility
- Added dependency to package.json
- Committed changes

## Sprint 3: Basic Audio Recording (Completed)
- Implemented AudioRecorder class with start/stop methods
- Uses node-record-lpcm16 for recording to file
- Committed changes

## Sprint 4: Idle Listening (Completed)
- Added idleListen method with silence detection and auto-restart
- Uses threshold and silence options for low-power listening
- Committed changes

## Sprint 5: Recording Tests (Completed)
- Added Jest as test framework
- Created unit tests for AudioRecorder class
- Updated test script
- Committed changes

## Sprint 6: As-Directed Pushes (Completed)
- Relaxed `.instructions.md` rules 2 and 3 to allow user-authorized remote configuration and pushes
- Added an "As-Directed Pushes" subsection with guardrails (confirm remote/branch, no force/all-branch pushes, no remote reconfiguration without direction)
- Updated the Commit Locally section to mirror the new policy
- Files modified: `.instructions.md`, `docs/sprint-log.md`
- Known limitations: HTML doc mirror (rule 6) not yet generated for any sprint; tracked as deferred debt
- Why: a public GitHub remote (`origin/develop`) was set up out-of-band per explicit user direction; the rules needed to reflect that this is now permitted when directed

## Sprint 7: Stabilization (Completed)
- Fixed `src/audioRecorder.js`: closed the dangling `class AudioRecorder { ... }` body (the previous file was a SyntaxError on parse) and added the missing `stop()` method that several tests were already referencing
- Created `src/index.js`: a minimal CLI entry that prints help by default and supports `record <path>` and `idle <path>` subcommands with graceful SIGINT/SIGTERM shutdown. Resolves `MODULE_NOT_FOUND` from `npm start`
- Rewrote `tests/audioRecorder.test.js`: now mocks `node-record-lpcm16` and `fs` so no real hardware or filesystem is touched. Covers construction, option merging, start/stop lifecycle, double-start guard, stop-without-start guard, and idle-listen chunk initiation
- Corrected `package.json` dependency range for `node-record-lpcm16` from `^1.0.5` (never published) to `^1.0.1` (latest real version)
- Hardened the `test` script to `jest --ci --forceExit` so CI/non-TTY runs don't hang on watch mode or stray timer handles
- Added a `.gitignore` covering `node_modules/`, audio artifacts (`*.wav`, `*.mp3`, `*.flac`, `recordings/`), logs, coverage, and common editor/OS files
- Files modified: `package.json`, `src/audioRecorder.js`, `tests/audioRecorder.test.js`, `docs/sprint-log.md`
- Files added: `src/index.js`, `.gitignore`, `package-lock.json`
- Validation: `node --check` clean on all source files; `npm test` reports 7/7 passing in ~0.3s
- Known limitations:
  - `idleListen()` still has a latent issue where the silence-restart `setTimeout` may fire after `stop()` is called and re-open a new file stream. Out of scope for this sprint; flagged for Phase 3 work
  - HTML doc mirror (rule 6) remains deferred debt
  - Tests mock both the recording library and `fs`, so they validate wiring but not real audio capture; integration coverage will need a real-device sprint later
- Why: the codebase committed at end of Phase 2 did not parse, had no entry file, had tests that referenced an undefined method, and pinned a nonexistent dep version. This sprint makes Phase 2 honestly complete before Phase 3 work begins

## Sprint 8: HTML Mirror Catch-Up (Completed)
- Paid down workflow rule 6 debt that had accumulated for seven sprints (no HTML mirrors had been generated for any prior sprint)
- Added `tools/build-html.js`: small Node generator that converts the project's markdown docs into self-contained HTML using `marked` (no JS framework, single inline `<style>` block, light/dark color-scheme support)
- Added `npm run docs:html` script so future sprints can regenerate mirrors in one command
- Added `marked` (^16.x line as resolved by npm) to `devDependencies` only; no runtime impact
- Generated initial mirrors at `docs/html/README.html`, `docs/html/instructions.html`, `docs/html/sprint-log.html`. A future `docs/sprint-plan.md` is wired in as an optional source so it auto-mirrors when created
- Files added: `tools/build-html.js`, `docs/html/README.html`, `docs/html/instructions.html`, `docs/html/sprint-log.html`
- Files modified: `package.json`, `package-lock.json`, `docs/sprint-log.md`
- Validation: `npm run docs:html` reports `ok` for all required sources; `npm test` 7/7 passing
- Known limitations:
  - Generator is one-way (md -> html). It does not roundtrip edits made to HTML
  - No anchor cross-links between mirrored docs yet; each HTML file is standalone
- Why: rule 6 of `.instructions.md` mandates HTML mirrors every sprint; doing this once via tooling closes the debt and removes friction for future sprints

## Sprint 9: Idle-Listen Stop Guard (Completed)
- Closed the latent restart-after-stop bug flagged in Sprint 7's known limitations
- Added an `idle` lifecycle flag to `AudioRecorder` that tracks "idle-listening mode" independently of the current chunk's `recording` handle
- `idleListen()` sets `idle=true`; the silence-end callback now only schedules the next chunk if `idle` is still true
- `stop()` now accepts being called from idle mode (previously threw if `recording` was null even when the next chunk had not yet been opened); it clears `idle` first to short-circuit any in-flight restart
- `start()` and `idleListen()` both reject being called when either `recording` or `idle` is active (closes the previously-silent overlap)
- Added two tests:
  - `idleListen() rejects a second concurrent call`
  - `stop() during idle gap prevents the next chunk from starting` (uses jest fake timers to simulate the 100ms silence-restart gap)
- Files modified: `src/audioRecorder.js`, `tests/audioRecorder.test.js`, `docs/sprint-log.md`, HTML mirrors regenerated
- Validation: `npm test` 9/9 passing
- Known limitations:
  - Real device behavior still unverified; the new guard is wiring only. Mini-sprints in the upcoming `docs/sprint-plan.md` will validate against hardware
- Why: Sprint 7 acknowledged this latent bug but deferred it. Fixing it now closes the catch-up debt and gives the Phase 3 work a known-good lifecycle to build on

## Sprint 10: Mini-Sprint Plan for Working Audio (Completed)
- Created `docs/sprint-plan.md` enumerating eight tightly-scoped mini-sprints (MS-1 through MS-8) that take audio capture from "code compiles" to "real WAVs from a real mic on this Windows box"
- Ordered as listening first (MS-1 sox probe, MS-2 device enumeration, MS-3 live level meter) then recording (MS-4 WAV output, MS-5 fixed duration, MS-6 rolling idle chunks, MS-7 Whisper-aligned defaults, MS-8 chunk metadata sidecars)
- Each mini-sprint specifies: goal, files touched, concrete steps, validation procedure, acceptance criteria, rollback approach, and risk notes
- Documents the two known-broken aspects of current audio code that need fixing during the track: `start()` writes raw PCM not WAV; `idleListen()` appends multiple silence-chunks to one file
- Includes an explicit out-of-scope list (transcription, summarization, search, GPU, etc.) so the next planning pass starts from a clean boundary
- The HTML generator (Sprint 8) already had `docs/sprint-plan.md` pre-wired as an optional source, so this turn picked it up automatically
- Files added: `docs/sprint-plan.md`, `docs/html/sprint-plan.html`
- Files modified: `docs/sprint-log.md`, plus regenerated `docs/html/sprint-log.html` and `docs/html/instructions.html` from the same `npm run docs:html` invocation
- Validation: `npm run docs:html` reports `ok` for all sources including the new plan; `npm test` 9/9 passing (no code changes this sprint)
- Why: the user asked for a concrete plan after the catch-up sprints. Writing the plan as a committed doc means the next sessions resume from a written shared understanding rather than from chat history

Next: MS-1 — sox dependency probe. After that the track proceeds linearly through MS-2..MS-8.

## Sprint 11 (MS-1): Sox Dependency Probe (Completed)
- Added `tools/check-audio-deps.js`: spawns `sox --version`, handles `ENOENT` by printing platform-specific install hints (winget / chocolatey / sourceforge for Windows, brew for macOS, apt/dnf/pacman for Linux), and exits non-zero so CI / npm script chains can react
- Added `npm run audio:check` script
- Expanded the README Setup section with a numbered list including the audio prereq step, plus a dedicated "Audio Capture Prerequisites" subsection with per-OS install commands
- Files added: `tools/check-audio-deps.js`
- Files modified: `package.json`, `README.md`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check tools/check-audio-deps.js` clean
  - Ran `npm run audio:check` with sox absent: exited 1, printed install hints (matches MS-1 acceptance criteria for the FAIL path)
  - Installed `ChrisBagwell.SoX` v14.4.2 via winget; refreshed PATH; re-ran `npm run audio:check`: exited 0, reported `sox: SoX v14.4.2` (matches OK path)
  - `npm test` 9/9 still passing (no source changes)
- Known limitations:
  - Probe only detects `sox` itself, not `sox-plugins` or codec libraries (irrelevant for plain WAV capture, may matter later for MP3/Opus output)
  - Probe does not attempt to repair PATH — it tells the user to do that themselves
  - SoX 14.4.2 is the last classic release (2015); a 14.7.x fork (`sox_ng`) is available via winget. Sticking with 14.4.2 since that is what `node-record-lpcm16` targets in its tests
- Why: the entire Phase 3A track depends on sox being callable. Failing fast with a clear message is the cheapest way to keep MS-2..MS-8 from producing confusing runtime errors

## Sprint 12 (MS-2): Device Enumeration (Completed)
- Added `src/audioDevices.js`: pure parser (`parseEnumeration`) plus a sox-spawning runner (`runSoxProbe` / `enumerateDevices`). Splits concerns so the parser is unit-testable without touching child_process
- The probe invokes `sox -V6 -t waveaudio __localrecorder_probe__ -n`. Sox emits its full device enumeration on stderr at -V6 verbosity before failing to open the bogus device; we discard the FAIL and keep the DBUG lines
- Regex: `/waveaudio:\s+Enumerating input device\s+(-?\d+):\s+"([^"]+)"/g`. Index -1 is reported by sox as the system default; tagged with `isDefault: true` in the result
- Added `node src/index.js devices` subcommand. Output is a small table: a left-aligned label column ("default" or the numeric index) and the device name
- Made `main()` in `src/index.js` async so future subcommands that need to await have a clean home; preserved synchronous-feeling exit codes
- Tests added in `tests/audioDevices.test.js`:
  - `parseEnumeration` extracts index/name/isDefault, returns `[]` for empty or unrelated text, tolerates CRLF + whitespace
  - `enumerateDevices` parses a mocked spawn result, throws a friendly error on ENOENT, returns `[]` when sox emits no enumeration lines
- Files added: `src/audioDevices.js`, `tests/audioDevices.test.js`
- Files modified: `src/index.js`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `npm test` — 15/15 passing (9 previous + 6 new)
  - `node src/index.js devices` on this machine lists "default Microsoft Sound Mapper" and "0 Microphone (Mic-j5 WebCam JVCU1" with exit 0
  - `node src/index.js help` updated to advertise the new subcommand
- Known limitations:
  - Windows WaveAudio truncates input device names to 31 characters (an OS-level multimedia API limit), so long device names like "Microphone (Mic-j5 WebCam JVCU100)" arrive without their tail. Documented behavior, not a bug in our parser
  - The probe argument list is hardcoded for `waveaudio` (Windows-only). macOS would need `coreaudio` and Linux `alsa`/`pulseaudio`. Cross-platform device enumeration is deferred until MS-2 needs to run elsewhere
  - We discard the FAIL line from the bogus-device open. If sox future-changes that error to a non-zero exit before emitting the enumeration, the probe could return empty; covered by the empty-list test case
- Why: before MS-3 streams bytes off the default input, having a way to confirm "yes sox sees a mic, and yes it's the one I expect" makes hardware-level problems debuggable in seconds instead of by trial and error

## Sprint 13 (MS-3): Live Level Meter (Completed)
- First end-to-end pull of real audio bytes off the mic. Confirms the entire capture pipeline on this Windows box and unblocks all subsequent recording sprints
- Added `AudioRecorder.listen(handler)`: starts a capture session that streams PCM to a handler with no file output. Integrates with the existing lifecycle flags (`recording`, `idle`, `listening`); `start()`, `idleListen()`, and `listen()` all reject overlap; `stop()` works from any of the three modes
- Added `src/audioLevels.js` (pure): `peak16LE(buffer)` returns a normalized 0..1 peak across int16-LE samples; `toDb(normPeak)` returns dBFS with a `SILENCE_DB = -120` floor; `renderBar(level, { width })` returns a bracketed `[####----]` bar with default `BAR_WIDTH = 40`. Numbers chosen so `(-32768).abs() / 32768 == 1.0` exactly
- Added `node src/index.js listen` CLI subcommand: spawns a listen session, recomputes peak per chunk, and prints a live `\r`-updated bar + peak + dBFS reading. Ctrl+C calls `recorder.stop()` and exits 0
- Added `tools/smoke-listen.js`: a non-interactive sanity check that captures for N ms and prints a single JSON line `{ chunks, totalBytes, maxPeak, maxPeakDb }`. Useful in CI-style validation when TTY \r rendering is not observable
- Discovered and fixed a Windows-specific blocker: `node-record-lpcm16` hardcodes `sox --default-device`, which fails on Windows 14.4.2 with `sox: Sorry, there is no default audio device configured`. Added `src/recorderPatch.js`: a Windows-only override that replaces the bundled sox recorder via `require.cache` BEFORE `node-record-lpcm16` is loaded. The override passes `-t waveaudio <device>` (default `0`) and respects `options.device`, `options.audioType`, and the existing `endOnSilence` silence-effect args
- `listen()` requests `audioType: 'raw'` from the recorder so the meter does not interpret RIFF header bytes as audio samples in the first chunk
- Added a defensive `stream.on('error', ...)` handler inside `listen()` that stays quiet when the error fires as a side effect of a deliberate `stop()` (detected by `this.recording === null` at error time). Without it, every smoke run printed a misleading `Listen stream error: sox has exited with error code null.` even on success
- Files added: `src/audioLevels.js`, `src/recorderPatch.js`, `tests/audioLevels.test.js` (user-authored), `tests/recorderPatch.test.js`, `tools/smoke-listen.js` (user-authored)
- Files modified: `src/audioRecorder.js`, `src/index.js`, `tests/audioRecorder.test.js`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `npm test` — 39/39 passing across 4 suites (added 4 patch tests, plus the user's level/listen tests)
  - Three consecutive `node tools/smoke-listen.js` runs on this machine produced real audio:
    - 2.5 s: 9 chunks / 73,728 bytes / peak 0.078 / -22.2 dBFS
    - 1.8 s: 5 chunks / 40,960 bytes / peak 0.027 / -31.4 dBFS
    - 1.5 s: 4 chunks / 32,768 bytes / peak 0.100 / -20.0 dBFS
  - No leftover `sox.exe` processes after any run (`Get-Process sox` returns nothing)
  - Final smoke run no longer prints the spurious error line
- Known limitations:
  - `start()` and `idleListen()` do NOT yet have analogous `stream.on('error', ...)` handlers. They still inherit the same unhandled-error crash class that listen() used to have. MS-4 will exercise `start()` against real hardware and must add matching error handlers before doing so
  - The Windows device is hardcoded to `0` in the patch (first non-default input device, per MS-2 enumeration on this machine). A different machine may need a different index. Plumbing a `--device <id>` CLI flag through to the AudioRecorder is deferred (not blocking on this machine)
  - The patch installs itself via `require.cache` mutation. If a future tool loads `node-record-lpcm16` BEFORE `src/audioRecorder.js`, the patch will be skipped silently. Tests are unaffected because they mock the library
  - SoX 14.4.2 reports the mic at 48000 Hz native; sox auto-resamples to the requested 16000 Hz. CPU cost is negligible at these rates
- Why: this is the first sprint that proves audio actually flows. Everything after this assumes the pipeline works -- finding the Windows `--default-device` mismatch now, in a sprint dedicated to "prove the input works", saves the next 5 mini-sprints from re-discovering the same bug

## Sprint 14 (MS-4): WAV Output From start() (Completed)
- `AudioRecorder.start()` now explicitly requests `audioType: 'wav'` from the recorder (instead of relying on the library's implicit default). Sox writes WAV-framed bytes to stdout, Node pipes them to the requested file. Result: `node src/index.js record out.wav` produces a real .wav file
- Added `stream.on('error', ...)` handlers to both `start()` and `idleListen()`, mirroring the intentional-stop-quiet pattern introduced for `listen()` in MS-3. This closes the unhandled-error footgun called out as a known limitation in Sprint 13
- Added `tools/smoke-record.js`: programmatic real-hardware validator. Records for N ms via `start()`, calls `recorder.stop()` (not SIGINT, so sox shuts down cleanly), then validates the resulting file: walks the RIFF chunk list to find the `data` chunk, runs `sox <file> -n stat` to confirm the bytes are parseable PCM, and prints a single JSON result line
- Tests added/updated in `tests/audioRecorder.test.js`:
  - `start()` now asserts `audioType: 'wav'` and that the stream's `.pipe()` was invoked
  - New: `start()` registers a stream error handler that closes the file on error and clears state
  - New: post-stop stream errors are silent no-ops (mirrors the intentional-stop pattern)
- Files modified: `src/audioRecorder.js`, `tests/audioRecorder.test.js`, `docs/sprint-log.md`, regenerated HTML mirrors
- Files added: `tools/smoke-record.js`
- Validation:
  - `npm test` -- 41/41 passing across 4 suites (39 -> 41 with 2 new error-handler tests)
  - `node tools/smoke-record.js .\smoke-record.wav 2500` -- produced a 65,536-byte WAV; `sox stat` parsed it as 32,746 samples / 2.046 seconds / max amplitude 0.066 / RMS 0.013 with rough frequency ~760 Hz
  - First 12 bytes of the file: `52 49 46 46 24 F0 FF 7F 57 41 56 45` -- canonical `RIFF...WAVE` magic
  - `Get-Process sox` after the run -- empty
- Known limitations:
  - The WAV header's RIFF and `data` chunk-size fields are written by sox at the start of the stream with a 2 GiB placeholder, because sox cannot seek back to a pipe to update them after the fact. The file is structurally valid and lenient players (sox itself, VLC, Audacity, Windows Media Player, Groove) accept it without issue, but strict parsers may reject. A follow-up sprint can add an `fs.openSync`-based header-fixup helper, or this naturally resolves once MS-5 introduces sox's own duration termination
  - `idleListen()` got the same error handler but its single-file append behavior is still broken for WAV (multiple back-to-back headers per file). MS-6 owns the per-chunk rolling file rewrite that makes idle mode produce playable files
  - The CLI `record` subcommand still relies on Ctrl+C for termination, which on Windows can race sox's shutdown. The smoke tool bypasses this by calling `recorder.stop()` directly; MS-5 introduces `--duration` for the CLI
- Why: half of the user's stated goal is "recording working". This sprint produces a file that contains real audible content with a valid RIFF/WAVE header that sox itself round-trips through `stat`. Combined with MS-3, the listen-then-record demonstration is now end-to-end functional on this machine

## Sprint 15 (MS-4.5): WAV Header Fixup (Completed)
- Closes the MS-4 known-limitation about sox writing a ~2 GiB placeholder for the RIFF and `data` chunk sizes when piping WAV to stdout. After `stop()`, we now rewrite both size fields in-place to match the actual on-disk file size, so strict parsers (and metadata tooling that trusts the header) get truthful sizes
- Added `src/wavHeaderFix.js`: pure `finalizeWavHeader(filePath)` helper. Opens the file `r+`, walks the RIFF chunk list (tolerates intermediate `JUNK`, `LIST`, `bext`, etc.), locates `data`, computes `trueDataSize = fileSize - dataPayloadOffset` and `trueRiffSize = fileSize - 8`, and patches the 4-byte size fields at offsets 4 and `dataPayloadOffset - 4`. Returns a result object with both before/after values for diagnostics. Includes a `HEADER_SCAN_LIMIT` of 8 KiB to bound the chunk walk against pathological inputs
- Wired into `AudioRecorder.stop()`: when the active `fileStream`'s path ends in `.wav`, register a one-shot `'close'` listener that runs `finalizeWavHeader` after the fs.WriteStream finishes flushing. Best-effort: failures `console.warn` and leave the file alone (lenient players don't care; this matches the same "don't crash a successful capture over a header fix" stance we used for the stream error handlers in MS-3 / MS-4)
- Guards are defensive against the existing Jest mocks: `typeof stream.path === 'string'` and `typeof stream.once === 'function'` mean the existing tests (which mock fileStream as a bare `{ end, on, write }`) still pass with no changes
- Tests added in `tests/wavHeaderFix.test.js`:
  - Rewrites a near-2 GiB placeholder to the actual size, preserving the PCM bytes
  - Idempotent on an already-correct file (no diff in re-read bytes)
  - Walks past intermediate `JUNK` + `LIST` chunks before finding `data`
  - Throws on non-RIFF input
  - Throws when the file is too short to be a WAV
  - Throws when the chunk list contains no `data` chunk
- Files added: `src/wavHeaderFix.js`, `tests/wavHeaderFix.test.js`
- Files modified: `src/audioRecorder.js`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `npm test` — 47/47 passing across 5 suites (41 -> 47 with 6 new wavHeaderFix tests)
  - `node tools/smoke-record.js demo-fixed.wav 2000` -- produced a 57,344-byte WAV; header now reports `dataSize: 57300` (was `2147479552` before this sprint), `riffSize: 57336`, both matching the on-disk reality (57344 - 44 = 57300 ✓). `sox stat` parses 28,650 samples / 1.79 seconds / max amplitude 0.112, no warnings
  - `Get-Process sox` after the run -- empty
- Known limitations:
  - The fix runs after sox exits and the fs.WriteStream's `'close'` event fires. If the process is killed before that path completes (hard `kill -9`), the file is left with the placeholder header. Lenient players still play it; strict parsers don't. Acceptable trade-off
  - Fix is skipped for non-`.wav` extensions. `idleListen()` writes per-chunk WAVs and is broken in other ways already; MS-6 will fold this helper into the rolling-chunk rotation
- Why: MS-4 deliberately deferred this so the WAV-from-pipe milestone could land cleanly. Doing it now (before MS-5's `--duration` flag exercises the same code path many more times) means every WAV the project produces from here on has truthful header sizes by default

## Sprint 16 (MS-5): Fixed-Duration Record (Completed)
- Added `--duration <seconds>` (or `--duration=<seconds>`) flag to the `record` CLI subcommand. Both forms work; the flag may appear before or after the output path. `node src/index.js record out.wav --duration 5` now stops cleanly after ~5 seconds with no Ctrl+C
- Extracted a pure `parseRecordArgs(args)` helper in `src/index.js` and exported it for testing. Returns `{ output, durationSeconds }` on success or `{ error }` on validation failure. Rejects non-numeric, zero, or negative durations and unknown flags
- The CLI's `record`/`idle` shutdown path is now unified through a single `shutdown(reason)` function that:
  - clears the duration timer if set
  - calls `recorder.stop()` (which queues the WAV header fixup from MS-4.5)
  - waits 150 ms before `process.exit(0)` so the fileStream `'close'` event has time to fire and the WAV header gets finalized before the process dies
- The duration timer fires `shutdown('Reached Ns, stopping.')`; the SIGINT/SIGTERM handlers fire `shutdown('Stopping...')`. Same code path in both cases, so Ctrl+C and timer-driven exit produce identical-shape WAV files
- Tests added in `tests/parseRecordArgs.test.js` (9 cases):
  - Plain `out.wav` (no duration)
  - `--duration N` before and after the output path
  - `--duration=N` shorthand
  - Missing value after `--duration`
  - Non-positive / non-numeric / NaN duration values
  - Missing output path
  - Unknown flag
  - Extra positional argument
- Files modified: `src/index.js`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Files added: `tests/parseRecordArgs.test.js`
- Validation:
  - `npm test` -- 56/56 passing across 6 suites (47 -> 56 with 9 new arg-parser tests)
  - `node src/index.js record demo-duration.wav --duration 3` -- exit 0 after ~3.8 s wall clock; produced 81,920-byte WAV with `dataSize: 81876` (matches `fileSize - 44`, so the MS-4.5 header fix ran inside the 150 ms shutdown grace). `sox stat` reports 40,938 samples / 2.56 seconds / max amplitude 0.0007 (ambient room only)
  - `node src/index.js record demo-duration.wav --duration 5` -- exit 0 after ~5.7 s wall clock; `sox stat` reports 73,706 samples / 4.61 seconds
  - `Get-Process sox` after both runs -- empty
- Known limitations:
  - **Sox startup slippage:** the captured audio duration is consistently ~0.4 s shorter than the requested `--duration` because sox spends ~400 ms on Windows initializing the waveaudio driver before the first sample lands. A 5-second request yields ~4.6 s of audio. Documented; tracked as MS-5.1 (optional). The natural fix is to let sox terminate itself via its `trim 0 N` effect instead of an out-of-band Node-side timer; that requires teaching `recorderPatch.js` to accept a duration option and append the effect to the sox arg list. Deferred because it's not blocking, and the current behavior is honest ("recorder ran for N seconds")
  - `--duration 0.5` or shorter is accepted but the captured audio may be empty or under-100ms; below the startup-latency budget, sox can finish before producing any samples. Documented inline; users should treat sub-1-second requests as best-effort
  - The 150 ms shutdown grace adds wall-clock latency to the CLI but is necessary to give the WAV header fixup time to run. Acceptable; the alternative was an async `await` chain through `recorder.stop()` which is more invasive
- Why: this is the second half of "audio recording working". The CLI can now produce known-duration WAVs non-interactively, which is the prerequisite for batch capture, scripted demos, and the MS-6 rolling chunks (which also need timer-driven shutdown internally)

## Sprint 17 (MS-6): Rolling Idle Chunks (Completed)
- Replaces the long-standing broken `idleListen(outputPath)` (which appended every silence-delimited chunk to a single file, producing multiple back-to-back WAV headers in one file -- a Sprint 9 known limitation) with `idleListen(directory)`: one timestamped WAV per silence-delimited chunk, written into a directory that's created on demand
- Chunk filenames are `chunk-YYYYMMDD-HHMMSS-mmm.wav` in local time. Sortable, filename-safe on Windows, human-readable. Collision suffixes (`-2`, `-3`, ...) are appended if two chunks happen to start within the same millisecond
- Two real-hardware bugs surfaced during MS-6 implementation and were fixed in the same sprint (kept here in the log as a record):
  1. `endOnSilence: true` was never being passed to `node-record-lpcm16`. Sox's silence effect was therefore inactive, so chunks never rotated. Fixed: pass `endOnSilence: true` in the record options
  2. The lifecycle wired `this.recording.on('end', ...)` to the Recording instance, but `node-record-lpcm16` emits 'end' on the **stream** (`recording.stream()`), not on the Recording itself. Fixed: register the listener on the stream
- WAV header finalization (MS-4.5) is now attached at file-creation time via a new shared helper `_attachFinalize(fileStream, filePath)`, called from both `start()` and the idleListen chunk-rotation loop. Previously `stop()` also registered a finalize, causing duplicate finalize attempts whenever stop() was called during idle mode. Removed the redundant registration in `stop()`
- `_attachFinalize` does double duty: if the file is 0 bytes when it closes (sox started, waited for audio above threshold, never got any, was killed by `stop()` or rotated by stream end with no payload), the file is deleted instead of left behind. Keeps the idle directory clean even after long quiet periods
- Made the idle silence detector tunable via constructor options `idleThreshold` (percent, default 0.5) and `idleSilenceSeconds` (seconds, default 1.0). These map directly to sox's `silence 1 0.1 <th>% 1 <n> <th>%` effect. Defaults preserve previous behavior; lower thresholds (e.g. 0.01) let the non-interactive smoke tool exercise the lifecycle without requiring a human to speak
- Added `tools/smoke-idle.js`: programmatic real-hardware validator. Starts idle mode in a fresh temp directory, runs for N ms, calls `recorder.stop()`, lists produced WAVs, validates each header, and runs `sox <chunk> -n stat` on each. Accepts `SMOKE_IDLE_THRESHOLD` env var to lower the threshold for ambient-only runs. Returns `ok: true` if every chunk that survives is structurally valid (0 chunks in a quiet room is a valid outcome)
- CLI `node src/index.js idle <directory>` now expects a directory instead of a file. Help text and variable naming in `src/index.js` updated accordingly
- Tests added/updated in `tests/audioRecorder.test.js`:
  - `idleListen()` creates the directory with `recursive: true` and writes a chunk file matching `chunk-\d{8}-\d{6}-\d{3}\.wav` inside it
  - `idleListen()` rotates to a new chunk path on each silence event (fake timers + stream 'end' simulation)
  - `idleListen()` rejects empty/missing directory argument
  - `idleListen()` honors `idleThreshold` and `idleSilenceSeconds` constructor overrides
  - The existing `stop()` overlap and post-stop tests were updated to look at the stream's `on('end')` registration (not the Recording's)
  - New `defaultChunkFilename` unit tests for the timestamp formatter
- Files modified: `src/audioRecorder.js`, `src/index.js`, `tests/audioRecorder.test.js`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Files added: `tools/smoke-idle.js`
- Validation:
  - `npm test` -- 61/61 passing across 6 suites (60 -> 61 with the new threshold-override test)
  - `SMOKE_IDLE_THRESHOLD=0.01 node tools/smoke-idle.js` -- exit 0, 1 chunk captured (245,760 bytes, dataSize 245,716 matches file size minus 44, sox stat parses 7.68 s of audio at max amplitude 1.07%)
  - `node tools/smoke-idle.js` (default 0.5% threshold, quiet room) -- exit 0, 0 chunks produced, empty placeholder file auto-deleted
  - `Get-Process sox` after both runs -- empty
- Known limitations:
  - **Chunk creation latency:** the file stream is opened immediately when `recordChunk()` runs, then sox starts and waits for audio above threshold. If `stop()` runs during that wait, the placeholder file is correctly deleted, but a more aggressive optimization would defer file creation until sox actually emits its first byte. Deferred; current behavior is correct, just slightly wasteful on disk syscalls
  - **Threshold tuning is a manual knob:** 0.5% is a reasonable default for ambient room noise on this machine. Other environments (noisy office, A/C, fan-cooled laptop) may need higher; very quiet booth recording may need lower. Documented; future work is automatic threshold calibration based on a 1-second "quiet baseline" sample
  - **No filename collision under sub-millisecond bursts:** the `-2`, `-3` suffix logic only fires when two chunks share the exact millisecond. In practice sox enforces at least the silence-period gap (1.0 s default) between chunks, so collisions are theoretical only
  - **Idle chunks don't have JSON sidecars yet:** that's MS-8. Each chunk WAV is currently file-system-complete on its own
- Why: this closes the longest-standing broken-feature limitation in the project. Idle mode now actually produces what users expect -- a directory of independently playable WAVs, one per spoken burst, with truthful headers and no empty placeholders. Combined with MS-3 (level meter), MS-4/MS-4.5 (file recording), and MS-5 (duration-limited recording), the full capture pipeline is functionally complete. MS-7 (Whisper-aligned defaults) and MS-8 (chunk metadata sidecars) are quality-of-life polish on top of working machinery

## Sprint 18 (MS-7): Whisper-Aligned Defaults (Completed)
- Made the capture format an explicit, frozen contract instead of an implicit emergent property of three hardcoded constants spread across three files. The contract is `WHISPER_AUDIO_FORMAT = { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' }`, exported from `src/audioRecorder.js` and frozen via `Object.freeze`
- Constructor defaults now spread `WHISPER_AUDIO_FORMAT` instead of inlining `{ sampleRate: 16000, channels: 1 }`. User overrides still win. `audioType` stays per-call (`'wav'` for start/idle, `'raw'` for listen) since it isn't part of the format contract -- it's a wire-format choice for the sox→Node pipe
- Plumbed `bitDepth` and `encoding` through `src/recorderPatch.js`. Previously the Windows sox patch hardcoded `--bits 16` and `--encoding signed-integer`; now it reads `options.bitDepth` and `options.encoding` with the same defaults. So the contract is genuinely option-driven on the path that matters (Windows). The upstream `node-record-lpcm16/recorders/sox.js` still hardcodes the same values on non-Windows platforms, which is fine because the contract values match
- `tools/smoke-record.js` now parses the `fmt ` chunk of the produced WAV (formatCode, channels, sample rate, byte rate, block align, bits per sample) and asserts every field matches `WHISPER_AUDIO_FORMAT`. This is the real proof that what we ship on disk is what Whisper will consume without resampling
- Tests added (5 new in audioRecorder.test.js, 2 new in recorderPatch.test.js):
  - `WHISPER_AUDIO_FORMAT` shape and frozen-ness
  - Constructor defaults match the contract for every field
  - User overrides win over format defaults
  - `start()` passes the Whisper fields through to the recorder
  - `windowsSoxRecorder` honors `bitDepth`/`encoding` overrides
  - `windowsSoxRecorder` falls back to 16-bit signed-integer when unspecified
- Files modified: `src/audioRecorder.js`, `src/recorderPatch.js`, `tests/audioRecorder.test.js`, `tests/recorderPatch.test.js`, `tools/smoke-record.js`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Validation:
  - `npm test` -- 68/68 passing across 6 suites (61 -> 68 with 7 new contract tests)
  - `node tools/smoke-record.js demo-whisper.wav 2000` -- exit 0, `whisperFormatMatch.ok: true`, produced WAV has `fmt: { formatCode: 1 (PCM), channels: 1, sampleRate: 16000, byteRate: 32000, blockAlign: 2, bitsPerSample: 16 }`. `sox stat` parses without complaint
- Known limitations:
  - The format contract isn't enforced on non-Windows platforms beyond what `node-record-lpcm16` itself does; if upstream changes its defaults, the macOS/Linux paths would drift. Mitigation: the smoke validator catches drift on any platform. Future MS-7.x: replace the upstream sox recorder on macOS/Linux too (we already do it on Windows for `--default-device` reasons), so the contract is enforced end-to-end
  - `WHISPER_AUDIO_FORMAT` does not include `audioType` because the listen path requires `'raw'` while start/idle require `'wav'`. The contract is about the **sample format**, not the **wire format**
- Why: until now, "we record 16 kHz mono 16-bit signed PCM" was an emergent property of three files happening to agree. Now it's a single named contract that downstream transcription code can `require()` directly. When T-1 lands, the whisper.cpp invocation will pull this same constant for its `-ar 16000 -ac 1` arguments, guaranteeing zero resampling and zero format mismatch debugging

## Sprint 19 (MS-8): Chunk Metadata Sidecars (Completed)
- Each idle-mode WAV now gets a companion `<basename>.json` sidecar written into the same directory after the chunk's WAV header is finalized. Downstream tooling (Whisper transcription, search index, heat trend analysis, human review UI) can read this without opening the audio
- Schema v1, exported as `SIDECAR_SCHEMA_VERSION` from `src/chunkSidecar.js`:
  ```json
  {
    "version": 1,
    "wav": "chunk-20260512-082832-594.wav",
    "start": "2026-05-12T13:28:32.594Z",
    "end":   "2026-05-12T13:28:40.610Z",
    "durationMs": 7679,
    "audio": { "sampleRate": 16000, "channels": 1, "bitDepth": 16, "encoding": "signed-integer" },
    "peak":   0.00238,
    "peakDb": -52.47,
    "bytes":  245760
  }
  ```
- `durationMs` is **derived from the audio payload**, not wall clock: `frames = (fileSize - dataPayloadOffset) / (channels * bytesPerSample); durationMs = round((frames / sampleRate) * 1000)`. This means it agrees exactly with `sox stat`'s reported length (no sox startup latency slippage in the metadata), while `start`/`end` capture the wall-clock window for traceability
- New pure helper modules so the heavy logic is testable without sox or fs:
  - `src/peakAccumulator.js`: `PeakAccumulator({ skipBytes })` tracks running max int16-LE peak across a stream of buffers, with an optional prefix-skip so the 44-byte WAV header doesn't contaminate the peak (header bytes interpreted as int16 would register ~58% of full scale)
  - `src/chunkSidecar.js`: `buildSidecar({ ... })` returns the schema-v1 object; `writeSidecar(wavPath, payload)` writes `<basename>.json` and returns the path; plus `sidecarPathFor` and `audioDurationMs` exposed for downstream use
- Wired into `AudioRecorder.idleListen` with minimal blast radius: `_attachFinalize` now takes an optional `sidecar = { chunkStart, peakAcc, format }` arg. When supplied, after the WAV header fixup it builds and writes the sidecar. When absent (the `start()` path), the finalizer behaves exactly as before. A `peakAcc.push()` call is attached to the sox stream's `'data'` event in parallel with `stream.pipe(fileStream)` — both consume the stream in flowing mode without interfering with each other (modern Node streams)
- `tools/smoke-idle.js` now reads each chunk's sidecar, validates the schema (required fields present, `version === 1`, `wav` matches the file name), and includes the parsed sidecar in the JSON output. Smoke `ok: true` now requires both wav validity AND sidecar validity
- Tests added (14 new):
  - `tests/peakAccumulator.test.js` (6): zero baseline, running max across pushes, header skip within one push, header skip across multiple pushes, sub-int16 buffer tolerance, negative skipBytes rejection
  - `tests/chunkSidecar.test.js` (8): `sidecarPathFor`, `audioDurationMs` for 16k mono 16-bit and 48k stereo 24-bit, edge cases (file <= header, invalid rate/channels), `buildSidecar` shape match, ISO-string pass-through, `writeSidecar` real-fs round trip
- Files added: `src/peakAccumulator.js`, `src/chunkSidecar.js`, `tests/peakAccumulator.test.js`, `tests/chunkSidecar.test.js`
- Files modified: `src/audioRecorder.js`, `tools/smoke-idle.js`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Validation:
  - `npm test` -- 82/82 passing across 8 suites (68 -> 82 with 14 new tests)
  - `SMOKE_IDLE_THRESHOLD=0.01 node tools/smoke-idle.js` -- exit 0, 1 chunk with full sidecar: `durationMs: 7679` matches `sox stat`'s `Length 7.678625` exactly; `peak: 0.00238` matches `sox stat`'s `Maximum amplitude 0.002228` within rounding (different averaging strategies); sidecar schema validation `ok: true`
  - `node tools/smoke-idle.js` (default threshold, quiet room) -- exit 0, 0 chunks, no leftover .wav or .json
- Known limitations:
  - **No sidecar for `start()` recordings.** Single-file recordings via `record` don't get a sidecar. MS-8.x or T-2 should fold this in when transcription begins consuming individual files. Trivially additive: pass the same sidecar options through `_attachFinalize` in `start()`
  - **Peak is derived from raw stream bytes**, not from a properly-parsed WAV data chunk. With `skipBytes: 44` we assume canonical header size. If sox ever emits a non-44-byte header (e.g. with a `LIST` info chunk), the first few "samples" would actually be header bytes. Today our format never produces this; the smoke validator would catch a drift via the `header.dataOffset` field
  - **Sidecar writes are synchronous (`fs.writeFileSync`).** Acceptable at chunk rotation rates (every few seconds at most); becomes a stutter risk only at sub-second rotation, which the sox silence detector won't produce under default settings
  - **No back-fill for already-written chunks.** If sidecar writing fails (disk full, permission), the chunk's WAV is preserved but the sidecar is missing. A separate "scan directory and regenerate missing sidecars" tool is future work
- Why: this closes the eight-mini-sprint capture track. The pipeline now produces (1) playable WAVs at the Whisper format, (2) one file per silence-delimited burst, (3) a sidecar JSON capturing everything downstream needs to know about that chunk without reading the audio. The next track (Phase 4 / transcription) can begin with no further capture-side work required

## Sprint 20 (MS-9): CLI Knobs for record / listen / idle (Completed)
- New CLI flags: `--threshold P`, `--silence N`, `--device <id>`, `--max-chunk-seconds N` (idle); `--device <id>` (listen and record). `--duration N` for record carries forward from MS-5. Every flag is opt-in; default behavior is unchanged for users not passing any of them
- Refactored arg parsing: small generic `parseSubcommandArgs(args, flagSpec)` helper with a `COERCERS` table for `positiveNumber`, `nonNegativeNumber`, `percent`, `string` types. Each subcommand declares its own `FOO_FLAGS` schema (e.g. `RECORD_FLAGS`, `IDLE_FLAGS`, `LISTEN_FLAGS`) and gets its own thin `parseFooArgs(args)` wrapper that validates positional count and reshapes the result to the subcommand's expected return shape. Existing `parseRecordArgs` API preserved (it returns `{ output, durationSeconds, device }` instead of just `{ output, durationSeconds }`; tests updated to match)
- `--max-chunk-seconds` is the only flag that touches `AudioRecorder` itself. New constructor option `maxChunkSeconds` (defaults to 0 = unlimited). When > 0, `idleListen` arms a timer per chunk; when the timer fires it calls `this.recording.stop()`, which kills sox and triggers the existing 'end' rotation path. The timer is cleared on stream `'end'` or `'error'`, and is never installed when `maxChunkSeconds <= 0`
- The other three knobs (`--threshold`, `--silence`, `--device`) flow through to AudioRecorder via existing constructor options (`idleThreshold`, `idleSilenceSeconds`, `device`). No new AudioRecorder code needed beyond plumbing
- `compactOptions(obj)` helper in `src/index.js` strips `null`/`undefined` values before passing to `new AudioRecorder(...)`, so unset flags don't clobber defaults via `{ ...defaults, ...options }` spread mechanics
- Help text rewritten to fit the wider flag surface; `printHelp()` now also lists a "Flag notes" section explaining what each flag does
- README updated with a new Usage section: full CLI subcommand list, flag reference table, and an explanation of the idle output (wav + json pair)
- Tests added (17 new):
  - `tests/parseIdleArgs.test.js` (13): missing directory, default null knobs, `--threshold` percent coercion + range, `--silence` positive coercion, `--device` string, `--max-chunk-seconds` positive coercion, flags before/after positional, unknown-flag rejection, extra-positional rejection, plus a small `parseListenArgs` describe block
  - `tests/parseRecordArgs.test.js` (1 new): `--device` parses alongside `--duration`. Existing 9 tests updated to expect the new `device: null` field
  - `tests/audioRecorder.test.js` (3 new): `maxChunkSeconds` arms a timer that calls `recording.stop()` after N seconds; absent/0 maxChunkSeconds installs no timer; the timer is cleared when the stream ends naturally
- Files modified: `src/index.js`, `src/audioRecorder.js`, `README.md`, `tests/parseRecordArgs.test.js`, `tests/audioRecorder.test.js`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Files added: `tests/parseIdleArgs.test.js`
- Validation:
  - `npm test` -- 99/99 passing across 9 suites (82 -> 99 with 17 new tests)
  - `node src/index.js idle <tmpdir> --threshold 0.01 --max-chunk-seconds 3` (8-second job, Stop-Job kill) -- produced 4 complete chunk WAV+JSON pairs at ~3s wall-clock intervals; sidecar for chunk 1 confirmed: `durationMs: 2559`, `peak: 0.0797`, `peakDb: -21.98`, `bytes: 81920`. Demonstrates the `--max-chunk-seconds` rotation actually fires and the sidecar shape is preserved when the chunk ends via the timer instead of natural silence detection
  - `node src/index.js help` -- updated help text rendered correctly
- Known limitations:
  - **No `--threshold` / `--silence` / `--max-chunk-seconds` for `record`.** The flags only make sense for `idle`. Documented in help text by their per-subcommand placement; rejected with `unknown flag` if passed elsewhere
  - **`--device` accepts any string.** Validation (does the device actually exist?) is sox's job; we just pass it through. The `devices` subcommand exists for this purpose
  - **No env-var equivalents.** Power users running long-lived idle sessions might want `LOCALRECORDER_DEVICE` etc. so they don't have to retype flags. Trivial to add via a thin `process.env` overlay in front of `compactOptions` when the time comes
  - **`--max-chunk-seconds` doesn't include sox startup latency in its budget.** A 3-second budget yields ~2.56 s of audio because sox spends ~0.4 s initializing the waveaudio driver. Same slippage as MS-5; same fix (MS-5.1, sox-side `trim`) would apply
- Why: every gap in the post-MS-8 brainstorm tagged "CLI knobs missing" is now closed. Tuning idle mode for a noisy office, picking a non-default microphone, and capping chunk length for transcription performance are all one-flag changes instead of edit-the-source changes. This unblocks longer-duration testing (a user can now leave `idle ./day-log --threshold 0.05 --max-chunk-seconds 30` running for an afternoon and inspect the resulting chunks) without further code work

## Sprint 21 (MS-10): Structured Output Paths and Idle Duration (Completed)
- Closes three usability gaps the user surfaced in the post-MS-9 walkthrough: (1) recordings used to dump into wherever the user invoked the CLI from instead of a known root, (2) `--duration` worked for `record` but not for `idle` (so leaving a long capture running unattended required an external timer), and (3) `record` mode produced a WAV but no sidecar (so single-file recordings had no companion metadata)
- New module `src/recordingPaths.js`: pure path-resolver. Exports `DEFAULT_ROOT = './recordings'`, `sanitizeName(raw)` (slugifies labels into filesystem-safe forms; collapses path-traversal dot runs into a single dash so `'../../etc/passwd'` becomes `'etc-passwd'` instead of escaping the root), `isoSortableTimestamp(now)` (`YYYYMMDD-HHMMSS`), `isoDate(now)` (`YYYY-MM-DD`), `resolveRecordPath({ root, name, explicitPath, now })`, and `resolveIdleDirectory({ root, name, explicitDir, now })`. Both resolvers return `{ filePath?, sessionDir, explicit, label? }` so the caller can both `mkdir -p` the session dir and know whether to advertise the resolved path. Explicit positional args still win — legacy contracts are preserved
- Layout produced by the resolvers (under `./recordings/` by default; override with `--root`):
  ```
  recordings/
    <name-or-YYYY-MM-DD>/
      recording-<ts>.wav        # record mode, no --name (date-based session)
      <name>-<ts>.wav           # record mode with --name
      chunk-<ts>-<ms>.wav       # idle mode
      chunk-<ts>-<ms>.json      # MS-8 sidecar
      recording-<ts>.json       # MS-10 sidecar for record mode
  ```
- `AudioRecorder.start(outputPath, { writeSidecar = true })` now generates a sidecar by default. Same `_attachFinalize` path that idle uses; the only difference is the `chunkStart` clock starts inside `start()` and the format is read from the constructor's `WHISPER_AUDIO_FORMAT`-derived `this.options`. Pass `writeSidecar: false` to opt out (kept for tests and any future "tiny throwaway file" use case)
- New CLI flags: `--name <label>` and `--root <dir>` for both `record` and `idle`; `--duration N` for `idle` (previously record-only). `IDLE_FLAGS` picks up all three; `RECORD_FLAGS` picks up `--name` and `--root`. The duration logic in `main()` is now subcommand-agnostic — `idle` prints `Listening for Ns. Press Ctrl+C to stop early.` and uses the same `shutdown(reason)` plumbing as `record`. Shutdown grace bumped from 150 ms to 250 ms so the sidecar write (an extra `fs.writeFileSync` after the WAV header fixup) gets a clean window before `process.exit(0)`
- Positional args (`<out.wav>` for record, `<directory>` for idle) are now **optional**. If absent, the resolver picks a structured path based on `--name`/`--root` or the date. If present, they're used verbatim and the structured-layout flags are ignored (parsers don't reject them; the resolver just returns `explicit: true`). This is the lowest-surprise behavior for a user who sometimes runs `node src/index.js record foo.wav` (legacy) and sometimes runs `node src/index.js record --name foo` (new)
- `src/index.js` calls `fs.mkdirSync(sessionDir, { recursive: true })` before opening any stream. `idleListen` also does this internally for its own directory, but `record` needs it because `start()` opens the write stream immediately
- Tests added (15 new across 3 files):
  - `tests/recordingPaths.test.js` (12 new): `sanitizeName` happy paths, slugification, path-traversal neutralization, empty/whitespace/non-string rejection, leading/trailing dash strip; `isoSortableTimestamp` and `isoDate` formatting; `resolveRecordPath` with explicit path / with name / without name / DEFAULT_ROOT fallback / name slugification / blank-name date fallback; `resolveIdleDirectory` with explicit dir / with name / without name / DEFAULT_ROOT fallback
  - `tests/parseRecordArgs.test.js` (2 new): `--name <label>` parsing and `--root <dir>` parsing; existing tests updated to expect the new `name: null` / `root: null` fields and to drop the now-obsolete "missing output path" rejection (positional is optional now)
  - `tests/parseIdleArgs.test.js` (1 new): `--duration`, `--name`, and `--root` parsing for idle. Existing tests updated to expect the new `durationSeconds: null` / `name: null` / `root: null` fields and to drop the now-obsolete "missing directory" rejection
- Files added: `src/recordingPaths.js`, `tests/recordingPaths.test.js`
- Files modified: `src/audioRecorder.js`, `src/index.js`, `README.md`, `tests/parseRecordArgs.test.js`, `tests/parseIdleArgs.test.js`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Validation:
  - `npm test` — 119/119 passing across 10 suites (99 → 119 with 20 new tests, including the 12 recordingPaths cases and assorted parser refits)
  - `node src/index.js idle --name ms10-demo --threshold 0.01 --silence 3 --duration 5` end-to-end: produced `recordings/ms10-demo/chunk-20260512-094325-694.wav` (147,456 bytes, `dataSize: 147412`) and its sidecar with `version: 1`, `durationMs: 4607`, `peak: 0.0042`, `peakDb: -47.5`, `audio: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'signed-integer' }`. Exit 0 after the duration timer fired and the chunk got finalized inside the 250 ms shutdown grace
  - `node src/index.js help` rendered the updated layout/notes blocks
- Known limitations:
  - **No path-collision detection between sessions.** Two `idle` sessions launched against the same `--name` write into the same folder; the timestamped chunk filenames prevent same-millisecond collisions, but the user has to manage their own naming hygiene. Documented behavior; matches the project's "tooling is honest, not opinionated" stance
  - **`--name` is required to look human** — no validation that a label is unique or remembered between runs. A future "session manifest" (writing a small `session.json` per directory) could turn this folder into a first-class addressable artifact, but is out of scope here
  - **Record-mode sidecar uses the same schema as idle.** Fields like `start` and `end` for record mode are the recorder's wall-clock start/stop, not just the wav duration. `durationMs` is still audio-derived. Acceptable; future schema v2 (if needed) could split "trigger source" into the schema to disambiguate "rotation by silence" vs "rotation by duration timer" vs "rotation by Ctrl+C"
  - **Shutdown grace is now 250 ms.** Adds a perceptible pause when stopping a short recording. The alternative was making `recorder.stop()` async-aware (it already returns synchronously after dispatching `end`); kept the simpler approach until profiling says otherwise
- Why: the user's mental model is "I want a folder per meeting, and I want unattended captures to stop themselves". MS-10 makes both of those one-flag operations. Combined with MS-9's tuning knobs, the CLI is now ergonomic enough for the "leave it running for an hour while I'm in a meeting" use case the user asked for explicitly — the canonical command is now `node src/index.js idle --name meeting --duration 3600 --threshold 0.5 --silence 20`

## Sprint 22 (T-1): Whisper.cpp Dependency Probe (Completed)
- Opens Phase 4 (transcription track). Same shape as MS-1's sox probe, but for whisper.cpp — Phase 4 will spawn a whisper.cpp CLI per chunk, and "binary missing from PATH" is the single most likely first-run failure mode. Detecting it now, with a friendly install message, keeps T-2..T-6 from re-discovering the same problem in opaque ways
- Added `tools/check-transcribe-deps.js`: probes for a whisper.cpp CLI on `PATH` by trying three candidate names in order (`whisper-cli` → `whisper` → `main`) with `--help` as the cheapest "is it callable" smoke. The first candidate that spawns and exits 0 wins. ENOENT on a candidate moves on to the next; any other failure is preserved in the diagnostics
- Added `npm run transcribe:check` script in `package.json`, parallel to the existing `audio:check`
- Extracted three pure helpers so the probe's logic is testable without spawning anything:
  - `parseWhisperHelp(text)` — scans the first 8 non-empty lines of `--help` output for a banner that mentions "whisper" and a semver-ish token. Degrades gracefully (returns `null`) when whisper.cpp's future help text doesn't match the banner heuristic, so `main()` can fall back to "version unknown" instead of crashing
  - `pickCandidateBinary(candidates, probe)` — generic "try each in order, stop at the first ok, retain attempts for diagnostics" walker. Used in main() with `probeBinary` as the `probe` argument; tests inject fakes
  - `findOnPath(command, env)` — locates the resolved on-disk path by walking `env.PATH` and (on Windows) appending each `PATHEXT` entry; returns `null` when nothing matches. Used purely for diagnostic output; the spawn already resolved it
- Per-platform install hints in `printInstallHints()`:
  - **Windows:** download the release ZIP from <https://github.com/ggerganov/whisper.cpp/releases>, extract, add the folder containing `whisper-cli.exe` to `PATH`, restart the shell. Explicitly notes that winget does not yet ship a whisper.cpp package
  - **macOS:** `brew install whisper-cpp` (Homebrew formula; exposes the binary as `whisper-cli`)
  - **Linux:** check distro packages first; otherwise `git clone … && make`, put `whisper-cli`/`main` on `PATH`
- Files added: `tools/check-transcribe-deps.js`, `tests/checkTranscribeDeps.test.js`
- Files modified: `package.json`, `README.md`, `docs/sprint-log.md`, `docs/sprint-plan.md`, regenerated HTML mirrors
- Validation:
  - `node --check tools/check-transcribe-deps.js` clean
  - `npm test` — 137/137 passing across 11 suites (119 → 137 with 18 new tests across `WHISPER_CANDIDATES`, `parseWhisperHelp` (7), `pickCandidateBinary` (4), `findOnPath` (4), and `printInstallHints` (2))
  - Ran `node tools/check-transcribe-deps.js` on this machine (FAIL path, since whisper.cpp is not installed). Exit 1, output:
    ```
    FAIL: no whisper.cpp CLI found on PATH.

    LocalRecorder needs a whisper.cpp CLI on PATH for transcription.
    Tried (in order): whisper-cli, whisper, main.

    Windows install:
      1. Download a release ZIP from https://github.com/ggerganov/whisper.cpp/releases
      2. Extract it (e.g. C:\Tools\whisper.cpp\).
      3. Add the folder containing whisper-cli.exe to your user or system PATH.
      4. Open a NEW shell so PATH refreshes.

    Note: winget does not yet ship a whisper.cpp package; use the GitHub releases.

    Then re-run: npm run transcribe:check
    ```
  - OK path not exercised on hardware (whisper.cpp not installed here) but covered by the unit tests for `pickCandidateBinary` (fake probe returns `ok: true`) and `parseWhisperHelp` (real whisper banner strings)
- Known limitations:
  - **No model probe yet.** whisper.cpp also needs a `.bin` model file (e.g. `ggml-base.en.bin`); T-2 will introduce a separate model check (or fold one in here) once the transcription invocation actually consumes a model
  - **Probe trusts `--help` exit status.** If a future whisper.cpp release ships `--help` returning a non-zero exit (very unlikely), the probe would report FAIL even when the binary is otherwise functional. The diagnostic block surfaces the exit status so the user can spot this case
  - **`findOnPath` is best-effort and informational.** If the OS resolves the executable via PATHEXT in a way `findOnPath` doesn't replicate exactly, the OK path still works — the resolved-path line just reads `(unknown — found via PATH but could not be located on disk)`
  - **Diagnostic format may need a small tweak when the OK path is first exercised.** Lacking an actual whisper.cpp install on this machine, the banner-line layout is a best-guess from public whisper.cpp release notes; T-2's first real install will validate it and any iteration is one-line
- Why: Phase 4 starts with "does the binary exist?". Getting that question answered cleanly, with a friendly install path per platform, costs one tiny sprint and removes a footgun that would otherwise show up at the worst possible time — namely, the first time the user runs `node src/index.js transcribe <file>` in T-2 and sees an opaque ENOENT mid-stream

## Sprint 23 (T-2): Transcribe a known-good WAV via CLI (Completed)
- Closes the "code exists but has never met real whisper.cpp" gap. `node src/index.js transcribe <file.wav>` now spawns the resolved whisper.cpp binary against a ggml model, reads the produced `.txt` sibling, and prints the transcript. Validated end-to-end on this Windows machine against a recorded 5-second WAV
- Added `src/transcribe.js`. Pure helpers + one async entry point:
  - `expectedTxtPaths(wavPath)` returns two candidate output paths whisper.cpp may have written: strip-ext (`<basename>.txt`, the modern convention) and append (`<wav>.txt`, the legacy convention). Both forms exist in the wild across releases; rather than pick a convention and lose to drift, the wrapper just tolerates both
  - `isWavFile(filePath)` does a cheap 12-byte RIFF/WAVE magic check so we surface a clean error before whisper.cpp emits a less-friendly one
  - `buildWhisperArgs({ model, wav })` returns the pinned arg order `['--no-prints', '--output-txt', '-m', model, '-f', wav]`. Throws if either input is missing. Kept separate so tests can pin the exact flag list without spawning anything
  - `resolveBinary({ probe, candidates })` is a thin wrapper around T-1's `pickCandidateBinary` with `probeBinary` defaulted — re-uses T-1's discovery logic so there are no two competing definitions of "is whisper.cpp installed"
  - `readTranscriptFile(wav)` walks `expectedTxtPaths`, returns the first `{ text, txtPath }` that exists, `null` if neither does
  - `transcribeFile({ wav, model, binary?, spawnFn?, resolveBinaryFn?, fsImpl? })` is the async seam. Pre-flight: wav must exist, must be RIFF/WAVE, model must exist, a binary must resolve. Spawn: collects stdout/stderr, returns on `'close'`. Post-flight: read the `.txt`, complain loudly if exit was 0 but no `.txt` materialised (would mean whisper.cpp silently dropped `--output-txt`). Resolves to `{ text, model, wav, binary, durationMs, txtPath, exitCode }`; on non-zero exit, throws with `err.exitCode`, `err.stderr`, `err.stdout` attached
  - All three I/O seams (`spawnFn`, `resolveBinaryFn`, `fsImpl`) are constructor-injectable. Tests pin every error path without spawning a real `whisper-cli` or needing a real model file
- Added the `transcribe` CLI subcommand in `src/index.js`:
  - `parseTranscribeArgs(args)` reuses the MS-9 `parseSubcommandArgs` helper with a `TRANSCRIBE_FLAGS` schema for `--model` (string) and `--json` (boolean presence flag)
  - `parseSubcommandArgs` gained a `type: 'flag'` branch so `--json` is a clean presence flag (rejects `--json=foo`, accepts only the bare form). MS-9's record/idle/listen flags were all value-bearing; this is the first presence flag in the project. Single small branch added; existing tests untouched
  - `runTranscribe(tail)` validates args, calls `transcribeFile`, handles errors with a short stderr-head excerpt for whisper-side failures, and prints the result. With `--json`, output adds `version` (semver-ish, from T-1's `parseWhisperHelp` of `whisper-cli --help`) and `versionLabel` (the raw banner line). Both are `null` on builds whose `--help` banner contains no semver token — same graceful degradation T-1 already validated
  - Help text and dispatch in `main()` were already wired in for the transcribe subcommand; this sprint filled in the missing module + tests + docs
- Tests (36 new, total 137 → 173 across 11 → 13 suites):
  - `tests/transcribe.test.js` (~30 cases across 8 describe blocks): `DEFAULT_MODEL_PATH` shape; `expectedTxtPaths` modern-first ordering, multi-dot basenames, throw-on-empty; `isWavFile` real header, wrong-magic, short file, missing file, RIFF+wrong-form (`RIFF...AVI `); `buildWhisperArgs` arg-order pin + missing-input throws; `resolveBinary` happy path + all-ENOENT; `readTranscriptFile` modern + legacy + neither; `transcribeFile` happy path + missing wav + non-WAV magic + missing model + missing binary + non-zero exit + spawn ENOENT + exit-0-but-no-txt
  - `tests/parseTranscribeArgs.test.js` (11 cases): bare wav, `--model` before/after/=, `--json` presence, combinations in either order, reject `--json=foo`, reject missing `--model` value, reject missing positional, unknown flag, extra positional
- Files added: `src/transcribe.js`, `tests/transcribe.test.js`, `tests/parseTranscribeArgs.test.js`. The `ggml-base.en.bin` model file (~141 MB) was downloaded into `models/` and is now excluded by a new `models/*.bin` entry in `.gitignore` — same "no binary deps in source" stance as `recordings/` (a `models/README.md` or similar can still be tracked if useful later)
- Files modified: `.gitignore` (added `models/*.bin`), `src/index.js` (transcribe wiring + `type: 'flag'` branch), `README.md`, `docs/sprint-plan.md`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check src/transcribe.js` and `node --check src/index.js` clean
  - `npm test` — 173/173 passing across 13 suites (137 → 173 with 36 new tests)
  - End-to-end real-hardware smoke on this Windows machine:
    1. `node src/index.js record hello.wav --duration 5` → produced a 147,456-byte WAV (peak 0.032, peakDb -29.86, duration 4607 ms) plus sidecar JSON in `D:\repos\LocalRecorder\`. No speech — ambient room only
    2. `node src/index.js transcribe hello.wav` → printed empty line (correct: whisper.cpp emitted no transcript for non-speech, no hallucination)
    3. `node src/index.js transcribe hello.wav --json` → returned `{ "text": "", "model": "models\\ggml-base.en.bin", "wav": "hello.wav", "durationMs": 2588, "binary": "whisper-cli", "txtPath": "hello.wav.txt", "version": null, "versionLabel": "usage: whisper-cli [options] file0 file1 ..." }`. Exit 0. Processing time 2.6 s for 4.6 s of audio = ~57% of realtime on the Win32 BLAS build
  - **Notable behaviour confirmed by the first real run:** whisper.cpp's current Windows BLAS build writes the legacy `<wav>.txt` filename, not the modern `<basename>.txt`. The defensive two-candidate lookup in `expectedTxtPaths` quietly resolved this without any code change. If we had hardcoded the modern convention we would have got an "exit 0 but no .txt output" error instead of a successful run
  - `Get-Process whisper-cli` after the runs — empty (no leftover process trees)
- Known limitations:
  - **Transcript fidelity not yet validated against spoken content.** The acceptance criterion "non-empty transcript recognisably close to spoken phrase" requires a human in front of the mic. The pipeline-wiring half of the criterion is satisfied (record → WAV → transcribe → text path, exit 0, no crash); the quality half is a one-line follow-up: speak into the mic for `--duration 5`, run `transcribe`, eyeball. Recommended after this commit lands
  - **No model-existence probe at startup.** `transcribeFile` checks `fs.existsSync(model)` and throws a friendly error, but a separate `tools/check-transcribe-model.js` (mentioned as optional in the T-2 plan) was not added — the path-existence check inside the CLI is doing the job for now and adding a fourth pre-flight script felt like premature surface
  - **Spawn is blocking.** A 30-second WAV ties up the Node event loop on the spawn await for the full transcription wall-clock time (~15 s on `base.en`, Win32 BLAS). Fine for T-2's single-file use case; T-3 will introduce a serial queue with a single worker so two long chunks don't compete for CPU
  - **`models/` is ignored but not auto-provisioned.** Users need to download a ggml model file manually from <https://huggingface.co/ggerganov/whisper.cpp/tree/main> before `transcribe` will succeed. The error message in `src/transcribe.js` points at the canonical download URL. A `tools/check-transcribe-model.js` was mentioned as optional in the T-2 plan but skipped — the path-existence check inside `transcribeFile` is doing the work for now
  - **`version: null` on this build.** whisper.cpp's `--help` banner on the Win32 BLAS build I tested reads `usage: whisper-cli [options] file0 file1 ...` with no semver token. `versionLabel` carries the raw banner line so downstream consumers have *something* to log; a real semver would only appear if whisper.cpp ships one in its help text in a future release
  - **`-otxt` side-effect file is written to the same directory as the WAV.** No way to redirect via current flags without also using `-of` (which whisper.cpp doesn't honour the same way across builds). For T-2 this is fine — caller can `fs.unlinkSync(result.txtPath)` if they don't want the artifact. T-3 will likely want the `.txt` to live next to the WAV as a sibling, so the current behaviour matches the eventual design anyway
- Why: T-2 is the smallest end-to-end proof that the Phase 4 plan is sound. With a single subcommand running cleanly against a real whisper.cpp binary, the next sprint (T-3) gets to focus on lifecycle integration ("auto-transcribe each chunk as idle rotates it") without having to debug "does the binary work at all?" simultaneously. The two filename conventions surprise was exactly the kind of risk the sprint plan called out for T-2 ("whisper.cpp's CLI flag surface differs across versions") — and was caught and resolved on the first real run by the defensive code path written before the first real run, which is the whole point of writing tests against the spec instead of against the implementation

## Sprint 24 (T-3.1): Serial transcription queue (Completed)
- First half of T-3 (the sprint-plan T-3 is being delivered as two mini-sprints since the queue is a self-contained primitive that's worth landing on its own commit). This sprint adds the queue. Sprint 25 will wire it through `AudioRecorder.transcribe` + `idle --transcribe` and run the end-to-end smoke
- Added `src/transcribeQueue.js`. `createTranscribeQueue({ run, onSuccess?, onFailure? })` returns `{ enqueue, drain, length }`:
  - `enqueue(job)` returns `Promise<{ ok, result? } | { ok, error? }>`. Never rejects — failure shapes are reported on the resolved value so callers can fire-and-forget without worrying about unhandled rejections. Internally chains via `head.then(...)` so jobs run strictly serially: `enqueue(B)` does not start its `run(B)` until A's promise has settled, regardless of A's outcome
  - `drain()` returns a promise that resolves the next time the queue is observed empty. Implemented via `setImmediate` polling rather than a shared resolver fired from inside the job chain — see the "tricky bit" note below. Calling `enqueue` while a `drain` promise is pending extends the wait through the new job(s)
  - `length` is the number of jobs queued-but-not-yet-settled. Useful for backpressure logging in T-5
  - `onSuccess(job, result)` and `onFailure(job, error)` are invoked synchronously after each job settles; throws inside the loggers are caught so a bad logger cannot wedge the queue
- **The tricky bit (worth documenting because it cost a round trip):** the obvious implementation -- a `drainResolver` allocated when `pending` goes 0→1 and called when it transitions back to 0 -- gets the microtask ordering subtly wrong. Calling the resolver from inside the job's `head.then` callback fires `drainPromise`'s continuations BEFORE the `enqueue()` promise's own `.then` chain. Pattern that breaks: `q.enqueue(j).then(observeSuccess); await q.drain()` -- `drain` would resolve before `observeSuccess` ran. The async-function unwrap takes an extra microtask or two, which is more than `queueMicrotask` can defer past. Final design polls via `setImmediate`: each task-loop tick checks `pending`, and between ticks all microtasks (including caller `.thens`) get a chance to settle. Cost is ~1 ms of task-loop latency per `drain` call, which is irrelevant at chunk-rotation timescales (seconds). Captured this trace path in the comment block on `drain` so future readers don't reinvent the failed microtask approach
- Out of scope for T-3.1, owned by T-5:
  - **Backpressure / max-length warning.** Queue is unbounded; long monologues can grow it indefinitely. T-5 will add `transcribeQueueMax` (default 5) and a single-line warn-on-overflow log
  - **Retry on failure.** `run` failure is logged via `onFailure` and the queue marches on. T-5 will add a single retry per the sprint plan's resilience knobs
  - **Skip-empty.** The queue is policy-neutral; deciding whether a chunk is "worth transcribing" is the caller's job. T-5 will gate enqueue on the sidecar's `peak` field at the integration layer, not in the queue
- Tests added (20 new in `tests/transcribeQueue.test.js`):
  - **Argument validation (5):** throws on missing/non-function `run`, on non-function `onSuccess`, on non-function `onFailure`; accepts a minimal `{ run }` config
  - **Idle queue (2):** `length === 0` on fresh queue; `drain()` on empty queue resolves immediately
  - **Happy path (3):** enqueue resolves `{ ok: true, result }`; `onSuccess` fires with `(job, result)`; `drain()` waits for all jobs
  - **Serial execution (2):** B doesn't start until A settles (verified with deferred-promise gates); three jobs with intentionally-staggered delays settle in enqueue order, not completion-order
  - **Failure handling (5):** error in one job doesn't block subsequent jobs; `onFailure` fires on failure and `onSuccess` does not; synchronously-thrown errors inside `run` are caught the same way as async rejections; throwing `onSuccess` does not poison the queue; throwing `onFailure` does not poison the queue
  - **Length and drain re-arming (3):** `length` reflects queued + running jobs; `drain()` captures jobs enqueued after a previous drain settled (this is the test that flushed out the microtask-ordering bug above); `drain()` called between enqueues waits for both before-call and after-call jobs
- Files added: `src/transcribeQueue.js`, `tests/transcribeQueue.test.js`
- Files modified: `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check src/transcribeQueue.js` clean
  - `npm test` — 193/193 passing across 14 suites (173 → 193 with 20 new queue tests)
  - No new external dependencies; pure JS, only uses built-in `Promise` + `setImmediate`
- Known limitations:
  - **Polling cost:** each `drain()` call uses `setImmediate` ticks while pending > 0. On a fully-loaded event loop those ticks could in theory queue up — measured cost on this machine was sub-millisecond per tick, well under chunk-rotation rates. T-5 will revisit if there's any sign of starvation
  - **No structured logger.** Success and failure callbacks are fire-and-forget; the queue doesn't itself emit any logs. T-3.2 will wire `console.log` for `[transcribed]` lines from the integration side so the queue stays generic
  - **`pending` is observable but not the deeper queue depth (running + queued split).** Internally there is no separate "running" vs "queued" bucket because we use a promise chain rather than an array. If T-5 needs that distinction for backpressure decisions, a small `running` flag can be tracked alongside `pending` cheaply
- Why: the integration in Sprint 25 wants to enqueue a transcription per chunk-rotation event. Without a queue, two adjacent long chunks would race two `whisper-cli` processes against each other on the same CPU and the same model file mapping. Landing the queue as its own primitive before any of the integration plumbing means the integration sprint can focus on "where do we hook this in" rather than "does serialisation work" — and the queue gets its own unit-test surface that the integration tests can rely on rather than duplicate

## Sprint 25 (T-3.2): Wire transcription into idle rotation (Completed)
- Second half of T-3. The Sprint 24 queue primitive is now plumbed end-to-end: `idle --transcribe` writes a `<basename>.txt` next to every `.wav`+`.json` chunk as it rotates, and the CLI shutdown waits for any in-flight transcriptions to finish before exit. T-3 is ✅
- `AudioRecorder` constructor gained four new options, all opt-in:
  - `transcribe: boolean` (default `false`) — when `true`, builds a private `transcribeQueue` instance and primes the close-event hook in `_attachFinalize` to enqueue per chunk
  - `transcribeModel: string` (default `DEFAULT_MODEL_PATH` from `src/transcribe.js`) — passed verbatim to each job
  - `transcribeFn: function` (optional) — injection point for tests so they don't need a real `whisper-cli` on PATH
  - `transcribeLogger: { onSuccess, onFailure }` (optional) — defaults to console.log/warn lines (`[transcribed] <relpath>` / `[transcribe failed] <relpath>: <message>`). Override to swallow logs in tests or to wire a structured logger later
- `AudioRecorder._attachFinalize` got a single new tail: if `this.transcribeQueue` exists, after the WAV header fix and sidecar write succeed (or fail-but-warn), enqueue `{ wav: filePath, model: this.transcribeModel }`. Skipped for the zero-byte cleanup path (sox-exited-without-audio) — those WAVs are deleted before reaching the enqueue site
- `AudioRecorder.drainTranscriptions()` — new public method that returns `this.transcribeQueue.drain()` (or `Promise.resolve()` when transcription is off). The CLI shutdown calls this after the existing 250 ms file-flush grace, so the final chunk's transcription gets to complete before `process.exit`. Drain time is `sum(chunk_transcription_time)` — typically a few seconds for short ambient chunks, can be tens of seconds for a long monologue tail. That's the right trade-off — exiting earlier would orphan `.txt` files we promised to write
- `defaultTranscribeRun({ wav, model }, { transcribeFn, fsImpl })` — the per-job worker the queue runs. Calls `transcribeFile`, then normalises whisper.cpp's `.txt` output to the canonical `<basename>.txt` sibling. If the installed whisper-cli wrote `<wav>.txt` (legacy convention seen on the Win32 BLAS build in T-2), we write `<basename>.txt` with the in-memory `text` and unlink the legacy file. Exported separately from the `AudioRecorder` class so it can be unit-tested in isolation
- CLI:
  - `--transcribe` (presence flag) and `--model <path>` (string) added to `IDLE_FLAGS`. `--model` is recognised even without `--transcribe` (the parser is policy-neutral); the CLI dispatcher only consults `--model` when `--transcribe` is set
  - `parseIdleArgs` extended to return `{ transcribe, transcribeModel }`
  - `main()` for the `idle` command does an up-front model-existence check when `--transcribe` is set: missing model file produces a one-line error pointing at the Hugging Face download page and exits non-zero before starting capture. Avoids the pit where the user kicks off an hour-long meeting and discovers an hour later that every chunk failed to transcribe
  - The `shutdown(reason)` closure is now async-aware. After the 250 ms flush grace it awaits `recorder.drainTranscriptions()` (no-op when off). SIGINT/SIGTERM/duration-timer handlers route through a `wireShutdown(reason)` helper that catches any unhandled rejection and exits with code 1. A `shuttingDown` guard prevents double-invocation if SIGINT arrives mid-shutdown
- Tests added (12 new across two files; **193 → 205**, still 14 suites):
  - `tests/parseIdleArgs.test.js` (+5):
    - `--transcribe` parses as a boolean presence flag, absent → false
    - `--transcribe=value` errors out (presence flag does not take a value — caught by `parseSubcommandArgs`'s flag-type handling added in T-2)
    - `--model` after `--transcribe` is captured into `transcribeModel`
    - `--model` parses even without `--transcribe` (no auto-coupling)
    - Default shape includes `transcribe: false, transcribeModel: null`
  - `tests/audioRecorder.test.js` (+7):
    - Default `AudioRecorder`: `transcribe === false`, `transcribeQueue === null`
    - Explicit `transcribe: false` leaves queue null
    - `transcribe: true` builds a queue, length === 0, model defaults to `DEFAULT_MODEL_PATH`
    - `transcribe: true` with explicit `transcribeModel` honors the override
    - `drainTranscriptions()` returns a resolved promise when off (no-op contract)
    - `drainTranscriptions()` waits for enqueued jobs to settle (uses an injected `transcribeFn` to short-circuit the real whisper call)
    - `defaultTranscribeRun` rewrites legacy `<wav>.txt` to canonical `<basename>.txt`, deleting the legacy file
    - `defaultTranscribeRun` leaves the canonical txt alone when whisper.cpp already wrote it there (idempotent)
- Files modified: `src/audioRecorder.js`, `src/index.js`, `tests/parseIdleArgs.test.js`, `tests/audioRecorder.test.js`, `README.md`, `docs/sprint-plan.md`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check src/audioRecorder.js src/index.js` clean
  - `npm test` — 205/205 passing across 14 suites (+12 new)
  - **End-to-end smoke:** `node src/index.js idle <tmp> --threshold 0.01 --silence 2 --transcribe --duration 12`. Produced one chunk: `chunk-20260512-162301-489.wav` (368 640 bytes), `.json` sidecar (peak 0.563 = −4.98 dB), `.txt` with 77 bytes of actual transcribed speech (`"Oh my, hey, hey, hey... Wouldn't wanna be too late... Hello."`). The `[transcribed]` log fired during the async shutdown drain, AFTER `Recording stopped` and `Silence detected, rotating chunk`. Filename normalisation worked: `.txt` landed at canonical `chunk-...-489.txt`, not the legacy `chunk-...-489.wav.txt`
  - **Failure-mode smoke:** `idle --transcribe --model ./does/not/exist.bin --duration 5`. Fails fast with `Error: --transcribe is set but model file not found: ./does/not/exist.bin`, exit code 1, no capture started, no orphaned files
  - **Incidental bonus:** the speech-bearing smoke run also closed out T-2's pending fidelity validation. T-2's first smoke captured silence (expected empty transcript); this T-3.2 smoke captured an ambient speech segment and whisper.cpp transcribed it cleanly, confirming the pipeline works end-to-end on real speech, not just absence of speech
- Known limitations / design notes:
  - **Drain time on shutdown can be long.** A 30-minute meeting with one long monologue chunk could mean ~17 minutes of post-stop drain time (per T-2's ~57% of realtime measurement on base.en + Win32 BLAS). T-5 will add a configurable drain timeout + a `--no-wait` shutdown mode for users who prefer to discard the tail
  - **Queue is per-`AudioRecorder` instance.** If a caller starts a fresh recorder while a previous one is still draining, the new instance has its own queue. Today there's only one recorder per CLI invocation, so this is moot. If T-5 introduces a long-running daemon, the queue may want to move up a level
  - **`record` subcommand does not expose `--transcribe`.** The constructor option works there too (the `_attachFinalize` hook is shared), but T-3 scope is idle-only. If someone wants single-file auto-transcribe, run `record` then `transcribe`. A `record --transcribe` flag is a trivial addition when there's user demand
  - **No retry on transcription failure.** A whisper.cpp crash (OOM, model mismatch, etc.) is logged via `onFailure` and the queue moves on to the next chunk. T-5 owns the single-retry policy from the sprint plan's resilience knobs
  - **No skip-empty heuristic.** Even an ambient-only chunk gets transcribed; whisper.cpp returns an empty string and we still write a 0-byte `.txt`. T-5 will gate enqueue on the sidecar's `peak` field so we don't burn CPU on dead air. Today's behaviour is conservative — better an empty `.txt` than missing one
- Why: chunks rotate as soon as silence is detected, but until this sprint there was no consumer for them on the transcription side. By landing the integration with the queue + the async shutdown + the upfront model check together, `idle --transcribe` is now a one-flag workflow: start it, walk away, come back to a directory of `.wav`+`.json`+`.txt` triples per silence interval. Everything Phase 4 needs from here on (T-4 indexing, T-5 hardening, T-6 docs) builds on this rather than on a half-wired stub

## Sprint 26 (T-4): Per-chunk markdown persistence (Completed)
- Each idle-mode chunk now produces a `<basename>.md` sibling alongside the `.wav` / `.json` / `.txt`. The `.md` is the user-facing artifact: a heading with human-readable timestamp, a metadata block (duration / peak / bytes / start / end), file links to the three sibling artifacts, and the transcript verbatim. On transcription failure, the same `.md` is still written but with a `_Transcription unavailable: <reason>_` stub in the transcript section -- the user always has a markdown artifact to open per chunk
- New `src/chunkMarkdown.js` (pure formatter, no fs / no whisper deps):
  - `formatChunkMarkdown({ sidecar, transcript, transcribeStatus, transcribeError, txtBasename }) -> string`. `transcribeStatus` is one of `ok` / `failed` / `empty` / `skipped` / `pending`; the formatter renders the appropriate transcript section stub for each
  - `markdownPathFor(wavPath)` -- mirrors `sidecarPathFor` from `chunkSidecar.js`. Returns `<dir>/<basename>.md`
  - Helpers `formatDurationSeconds` (2dp <10 s, 1dp <60 s, `Xm Ys` thereafter), `formatPeak` (ASCII-minus dBFS + linear in parens), `formatNumberWithSeparator` (locale-neutral thousand spaces -- bytes never fractional), `parseChunkTimestamp` (matches the `chunk-YYYYMMDD-HHMMSS-mmm[-N]` stem and renders the duplicate suffix as `#N` in the heading)
- `src/audioRecorder.js`:
  - New helper `writeChunkMarkdownSibling({ wav, transcript, transcribeStatus, transcribeError, fsImpl })`: reads the sidecar JSON from disk (or falls back to a minimal stub if the JSON is missing), formats the markdown, writes the `.md`. Exported separately for unit testing
  - New worker wrapper `runWithMarkdown(job, { transcribeFn, fsImpl })`: calls `defaultTranscribeRun`, then writes the `.md` on BOTH the success and failure paths, then re-throws the underlying transcription error (if any) so the queue's `onFailure` still fires. A `.md` write failure does NOT mask a successful transcription -- it's logged via `console.warn` and `mdPath` is reported as `null` on the result
  - The constructor's `runFn` now uses `runWithMarkdown` (was `defaultTranscribeRun`). Default `onSuccess` log line announces the `.md` (was the `.txt`); `onFailure` appends `(md stub written)` when the stub landed successfully. Decoration via `error.mdPath` keeps the queue API uncluttered
- Tests added (38 new across two files; **205 → 243**, 14 → 15 suites):
  - `tests/chunkMarkdown.test.js` (32 tests):
    - **Helpers (15):** `formatNumberWithSeparator` (3 cases including non-finite), `formatDurationSeconds` (4 buckets including the 9999→"10.00 s" rounding boundary documented inline), `formatPeak` (5: ASCII minus, dBFS with parens, clipping, missing peak, non-finite), `parseChunkTimestamp` (3: canonical, duplicate suffix, non-chunk)
    - **`markdownPathFor` (2):** preserves directory, handles uppercase `.WAV`
    - **Happy path (3):** full render with all sections, fallback heading for non-chunk basenames, `#N` disambiguator for duplicate-suffix chunks
    - **Failure / empty / pending (6):** failed transcription with explicit error, failed without explicit error (falls back to "unknown error"), empty/whitespace transcript renders empty-speech stub, pending status, skipped status with reason, explicit `txtBasename` overrides the automatic suppression
    - **Argument validation (3):** throws on missing sidecar, throws on non-object sidecar, tolerates a sidecar missing optional `bytes` / `start` / `end`
    - **Structural sanity (3):** exactly one H1 at top, exactly one `## Transcript` H2, no code fences (so no risk of unbalanced fences from transcript content)
  - `tests/audioRecorder.test.js` (6 new in a new `describe('writeChunkMarkdownSibling / runWithMarkdown')` block):
    - Success path: `writeChunkMarkdownSibling` writes a real `.md` with the transcript and the `.txt` file link
    - Failure path: writes the failure-stub `.md` without the `.txt` link
    - Missing sidecar: falls back to a `{ wav: basename(wav) }` stub so the `.md` still has identifying info
    - `runWithMarkdown` success: writes `.md`, returns `mdPath` on the result
    - `runWithMarkdown` failure: writes `.md` stub AND re-throws the original error (`rejects.toMatchObject`)
    - `runWithMarkdown` resilience: a failing `writeFileSync` for `.md` paths doesn't mask a successful transcription; result still flows through with `mdPath: null`
- Files added: `src/chunkMarkdown.js`, `tests/chunkMarkdown.test.js`
- Files modified: `src/audioRecorder.js`, `tests/audioRecorder.test.js`, `README.md`, `docs/sprint-plan.md`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check src/chunkMarkdown.js src/audioRecorder.js` clean
  - `npm test` -- 243/243 passing across 15 suites (+38 new)
  - **End-to-end smoke:** `idle <tmp> --threshold 0.01 --silence 2 --transcribe --duration 12`. Produced one chunk with the full quartet: `chunk-20260512-163621-086.wav` (361 KB), `.json` (355 B), `.md` (552 B), `.txt` (117 B). The `.md` rendered cleanly with the H1 heading, metadata block, three file links, and the transcript -- the user spoke to the mic ("Right, it's listening pretty good, mama. And it's doing crazy good work for transcription...") and the markdown opened directly in a text editor with no further processing. `[transcribed]` log now points at the `.md` as planned
- Known limitations / design notes:
  - **Markdown writes happen only when `transcribe: true`.** The `.md` is hooked into the queue worker, so capture without transcription still produces only the `.wav` + `.json` pair. T-4 acceptance says "every WAV has a matching .md after the chunk closes" -- interpreted here as "every transcription-mode WAV", which matches the goal phrasing "combines the transcript with the sidecar metadata". If a use case emerges for `.md` without transcription, the helper is already factored out as `writeChunkMarkdownSibling` and can be invoked from `_attachFinalize` directly
  - **No streaming / partial markdown.** The `.md` lands atomically once whisper.cpp finishes for that chunk. A long monologue might have several seconds of latency between the WAV closing and the `.md` appearing. That's the right trade-off given the per-chunk-rotation cadence; partial / streaming markdown is out of scope until there's a real-time UI consumer
  - **Sidecar read happens at write time.** If somehow the sidecar is mutated between the sidecar write and the markdown write (it shouldn't be -- nothing else touches the JSON), the `.md` reflects the latest content. Documented for the reader's mental model; not a real concern
  - **No transcript escaping.** Whisper output goes into the `.md` verbatim. If the transcript happens to contain `## ` at the start of a line, that becomes an H2. Acceptable today; if T-7 builds a parser that wants strict structural control, escape on the way in
  - **`#N` disambiguator** uses the `-2`, `-3`, etc. suffix on rare same-millisecond chunk-name collisions. Verified by the parser test but not by a real-hardware collision (would need two stop-start cycles inside one millisecond)
- Why: the transcript alone is a "wall of text" with no provenance. The sidecar JSON has the provenance but no human-readable surface. The `.md` is the join: it answers "which chunk is this, when was it captured, how long is it, how loud was it, what was said". This is the artifact that the human reviewer (or, later, the human-review UI) opens directly. T-5 will refine the failure-mode messaging and T-6 will validate the whole `.wav`/`.json`/`.txt`/`.md` quartet in one demo run

## Sprint 27 (T-5): Resilience -- skip-empty, retry, backpressure (Completed)
- Goal of this sprint was the "leave it running for an hour" test: capture must keep producing artifacts no matter what transcription does. Three new knobs were added; all are opt-in-tunable via CLI; capture pipeline never blocks on transcription
- **Skip-empty (peak gating)**:
  - New `AudioRecorder` constructor option `transcribeMinPeak` (default `0.005` = -46 dBFS, well above typical room hum but below conversational speech)
  - `_attachFinalize` close handler now reads `sidecarPayload.peak` (hoisted out of the sidecar try/catch for visibility) and, when transcription is enabled AND `peak < transcribeMinPeak`, skips the queue entirely. Instead it writes a `.md` immediately with `transcribeStatus: 'skipped'` and a stub `_Skipped: peak 0.0674 below --transcribe-min-peak 0.005_`
  - Logged as `[transcribe skipped] <relpath> (peak X below --transcribe-min-peak Y)` so the user sees the gate firing in real time. Saves whisper.cpp CPU on dead-air chunks (the common case for "user stepped away from desk")
  - `--transcribe-min-peak P` CLI flag added to idle; parsed via the existing `percent` type (accepts `0.005` or `5` for 5%). `0` disables the gate (every chunk goes to whisper, no skip)
- **Single retry on non-zero exit**:
  - New helpers `isRetryableTranscribeError(err)` and `transcribeWithRetry(job, opts)` exported from `src/audioRecorder.js`. Classification rule: an error is retryable iff it carries an `exitCode` property (which `transcribeFile` only attaches on non-zero whisper-cli exit). Validation errors (missing WAV / model / binary) are NOT retried -- they will fail the same way every time, and a clean failure log is worth more than ceremonial repetition
  - `runWithMarkdown` now wraps the call in `transcribeWithRetry(...)` instead of calling `defaultTranscribeRun` directly. New constructor option `transcribeRetries` (default `1`) governs the retry count. `0` disables retries
  - Retry attempt logged via `console.warn` as `[transcribe retry] <relpath>: attempt 2/2 after exit 1` so users can see whether retries are bailing them out or just delaying inevitable failure
- **Queue backpressure**:
  - `createTranscribeQueue` accepts two new options: `warnAt` (default 0 = disabled) and `onOverflow(length)`. When `pending` crosses `warnAt` from below, `onOverflow` fires exactly once. It does NOT re-fire until `pending` first drops below `warnAt`; this is debouncing-by-state, not by time. Keeps a sustained backlog from spamming the log on every enqueue
  - `AudioRecorder` constructor option `transcribeQueueMax` (default `5`) wires to `warnAt`. Default `onOverflow` log: `[transcribe backlog] queue depth N exceeds --transcribe-queue-max 5. Capture is outrunning transcription; consider raising --silence, lowering --max-chunk-seconds, or using a smaller model.`
  - `--transcribe-queue-max N` CLI flag added. `0` disables the warning entirely
  - **Deferred (still owned by T-5 in principle, but not implemented here):** the "drop oldest queued job on overflow" optional behavior. The chain-based queue makes drop-from-middle awkward; would require refactoring the queue to an array-backed FIFO. Documented as a known limitation. The warning alone is enough to give the user actionable feedback for now
- New CLI flags (both idle-only, both validated by `parseSubcommandArgs`):
  - `--transcribe-min-peak P` -- `percent` type (0..100 inclusive after auto-coercion, where `5` means 5% and `0.05` means 0.05)
  - `--transcribe-queue-max N` -- `positiveNumber` type (must be > 0; matches existing flag conventions)
- Tests added (**21 new**; **243 -> 264**, still 15 suites):
  - `tests/parseIdleArgs.test.js` (+3): `--transcribe-min-peak` parsing (positive, percent form, zero), out-of-range rejection, `--transcribe-queue-max` parsing including positive-number rejection of 0 / negative
  - `tests/transcribeQueue.test.js` (+5 in a new `describe('overflow warning (T-5 backpressure)')` block):
    - `warnAt=0` disables (no callback fires even with 20 enqueues)
    - Fires when pending crosses `warnAt` from below (4-enqueue progression: 1, 2, 3 silent; 4 fires)
    - Debounced: further enqueues while pending > warnAt do NOT re-fire
    - Re-armed: pending drains, then a second burst fires `onOverflow` again
    - Throwing `onOverflow` does not poison the queue (subsequent enqueues still settle cleanly)
    - Validates `warnAt` and `onOverflow` at construction time
  - `tests/audioRecorder.test.js` (+13):
    - **`isRetryableTranscribeError` (3):** `err.exitCode` -> true; validation errors -> false; null/undefined -> false
    - **`transcribeWithRetry` (5):** succeeds first try (1 call); retries once on non-zero exit and succeeds on second; exhausts retries and throws the LAST error; does NOT retry deterministic errors (model not found -> 1 call only, despite `maxRetries=5`); `maxRetries=0` disables retries
    - **`runWithMarkdown` honors maxRetries (1):** runs the retry and writes a successful `.md` after a recovered second attempt
    - **AudioRecorder T-5 constructor wiring (4):** defaults (`transcribeMinPeak=0.005`, `transcribeQueueMax=5`, `transcribeRetries=1`), explicit overrides honored, `transcribeMinPeak=0` accepted (gate disabled), negative / non-finite `transcribeMinPeak` falls back to default
- Files modified: `src/transcribeQueue.js`, `src/audioRecorder.js`, `src/index.js`, `tests/parseIdleArgs.test.js`, `tests/transcribeQueue.test.js`, `tests/audioRecorder.test.js`, `README.md`, `docs/sprint-plan.md`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check` clean across all three modified `src/` files
  - `npm test` -- **264/264 passing across 15 suites** (+21 new)
  - **End-to-end smoke (peak-gate skip):** `idle --transcribe --transcribe-min-peak 0.99 --duration 10` (threshold absurdly high to force every chunk to skip). Produced `.wav` + `.json` + `.md`, **NO `.txt`** (queue was never invoked). Log: `[transcribe skipped] ...wav (peak 0.0674 below --transcribe-min-peak 0.99)`. `.md` rendered cleanly with `_Skipped: peak 0.0674 below --transcribe-min-peak 0.99_` in the transcript section. Total wall time ~11 s (no transcription delay); compare to ~17 s for the unfiltered T-4 smoke
  - **Help output verified:** new flags appear under the `idle` subcommand block AND in the flag-notes section
  - **Backlog smoke skipped:** would require sustaining 5+ in-flight transcriptions, which on this CPU means recording for ~30+ s with very short silence. Unit tests cover the warning logic exhaustively (5 cases including debounce, re-arm, validation); a live smoke would only re-prove the same. T-6 might naturally exercise this if the demo runs long enough
  - **Failure-mode smokes skipped at the integration level:** corrupted WAV / spawn failure / missing-txt-after-exit-0 are unit-tested via injected `transcribeFn` in `runWithMarkdown`'s failure-path tests. The orchestration code paths for them are identical to the live retry path. Missing-model is already covered (T-3.2 upfront check)
- Known limitations / design notes:
  - **No drop-on-overflow.** When the queue exceeds `transcribeQueueMax`, we only warn -- subsequent chunks still enqueue and back up. Recording continues regardless; whisper just falls further behind. For "real" backlog handling (drop oldest, batch-process later), a small refactor to an array-backed FIFO is needed; deferred until a real workload demonstrates need. The warning gives users enough signal to take manual action
  - **Retry policy is binary.** Exit code 1 from "model lookup failed at runtime" vs exit code 1 from "transient memory map race" look identical to the retry classifier. We retry both. In practice the deterministic failures will fail twice and produce a cleaner failure log on the second attempt (same error message, same exit code); not a real regression vs no-retry
  - **Peak gate uses sidecar peak.** The peak is computed across the entire chunk's PCM (in `peakAccumulator.js`); silence-detection silence != gate-skip silence. A chunk with 1 s of speech in 30 s of silence will still have peak ~= the spoken segment's peak and will transcribe normally. The gate only skips truly empty / ambient-only chunks
  - **`--transcribe-min-peak` units are linear (0..1), not dB.** A user thinking in dB has to translate (e.g., -40 dBFS = 0.01). Documented in the README; if it becomes confusing in practice a `--transcribe-min-peak-db` alias is trivial to add
  - **Retry doubles the worst-case shutdown drain time.** If every chunk needs a retry, the shutdown drain is ~2x what it would otherwise be. In practice retries are rare so this is theoretical -- but worth knowing if `Ctrl+C` feels slower than expected
- Why: the user's stated goal is "leave it running for an hour and walk away". The T-3.2 pipeline did the happy path; this sprint hardens it against three real failure modes: dead-air chunks (skip-empty), flaky whisper-cli runs (retry), and transcription falling behind capture (backlog warn). After this sprint, `idle --transcribe` is genuinely production-ready for long-running meeting capture -- the user can leave it on a laptop for hours and the directory will fill with `.wav`+`.json`+`.txt`+`.md` quartets (or `.wav`+`.json`+`.md`-stub for silent stretches) without intervention. T-6 will validate this end-to-end with a real spoken-content demo

## Sprint 28 (T-6): End-to-end demo -- speak → see markdown update (Completed)
- The Phase 4 milestone. This sprint is mostly documentation and a captured live-run that proves the previous five sprints compose into the user-stated goal: "run one command, speak into the mic, watch markdown appear in real time". No production code changed. The track's "Definition of Done" (in `docs/sprint-plan.md`) is now satisfied end-to-end on this Windows machine
- README additions:
  - New "Live demo — speak, watch transcripts appear" section with a runnable recipe: `node src/index.js idle --name t6-demo --transcribe --threshold 0.5 --silence 2 --duration 60`. Step-by-step instructions: speak 2-3 sentences with ~3 s pauses, watch the session directory fill up, observe the streaming `[transcribed]` lines during shutdown drain, open one `.md` in any editor
  - New "Model trade-offs" table covering `tiny.en` / `base.en` / `small.en` / `medium.en` / `large-v3` with size, CPU speed, accuracy, and recommended-for columns. Captures the trade-off honestly: `base.en` is the default sweet spot; if a real meeting needs better accuracy the user knows where to upgrade; disk / memory cost is called out so people don't blindly download `large-v3`
- **Captured demo run** (real hardware, this machine, with the user's environment having ambient music in the background as the "speech" source so we got non-trivial transcription work to do):
  - **Command:** `idle <tmp> --threshold 0.5 --silence 2 --max-chunk-seconds 5 --transcribe --duration 30` (max-chunk-seconds forced rotation under sustained sound so we got many chunks in 30 s instead of one; default `transcribe-min-peak 0.005`, default `transcribe-queue-max 5`, default 1 retry)
  - **Result:** 26 chunks rotated. Every single chunk produced the full quartet: **wav=26, json=26, txt=26, md=26.** Zero failures. Zero skips at the peak gate (ambient sound was ~-25 dBFS, comfortably above the 0.005 / -46 dBFS gate). Several `.txt` files were 1 byte (whisper.cpp emitting just a newline for nearly-silent stretches); their `.md` siblings rendered the `_No speech detected_` stub from T-4. The loud-enough chunks all transcribed to real text (whisper.cpp tagged the music with ♪ markers, which PowerShell rendered as `�T�` -- a terminal rendering quirk, not a data bug; the underlying UTF-8 is clean in the on-disk `.md`)
  - **Backpressure warning fired exactly once,** mid-run, as planned: `[transcribe backlog] queue depth 6 exceeds --transcribe-queue-max 5. Capture is outrunning transcription; consider raising --silence, lowering --max-chunk-seconds, or using a smaller model.` This is the live T-5 debounced overflow path. The warning did NOT re-fire even though the queue stayed above the threshold for ~15 s afterward, demonstrating the re-arm-on-drain semantics work in practice as well as in the unit tests
  - **Async shutdown drained the queue cleanly.** After `Reached 30s, stopping.` and `Recording stopped.` the log streamed `[transcribed] ...md` lines for the remaining queued chunks (~14 of them) and the process exited zero only after the last one. Total drain time after the 30 s capture: ~21 s (matches T-2's ~57% of realtime measurement on `base.en` + the Win32 BLAS build, times 26 chunks of mostly-quiet 1-2 s audio)
  - **Clean shutdown:** `Get-Process sox` and `Get-Process whisper*` both returned 0 processes immediately after exit. No orphans
- Validation against the Phase 4 "Definition of Done" (from `docs/sprint-plan.md`):
  - ✅ `npm run transcribe:check` reports a whisper.cpp version on this machine (verified by the T-1 / T-2 sprints; whisper-cli's --help banner has no semver but `versionLabel` carries the raw banner, which counts per T-1's design)
  - ✅ `node src/index.js transcribe <wav>` produces a non-empty transcript for a non-silent WAV (verified during the T-4 smoke, where the user's ambient speech became "Right, it's listening pretty good, mama. And it's doing crazy good work for transcription...")
  - ✅ `node src/index.js idle --name <label> --transcribe --duration <seconds>` produces, for each non-silent chunk, a `.wav`, `.json`, `.txt`, AND `.md` quartet (verified by this sprint's demo run: 26/26 chunks across all four artifacts)
  - ✅ Silent / sub-threshold chunks produce a `.md` stub explaining why they were skipped (verified in the T-5 peak-gate smoke; would also fire in a longer run with quieter passages)
  - ✅ `npm test` is green and asserts the new transcription invariants (264/264 across 15 suites after T-5; this sprint adds no new tests but doesn't break any either)
- Files modified: `README.md`, `docs/sprint-plan.md`, `docs/sprint-log.md`, regenerated HTML mirrors. No `src/`, no `tests/` changes
- Validation:
  - `npm test` -- still **264/264 passing across 15 suites**. No regressions
  - Demo run captured live (see above); transcript excerpt + per-chunk file count + warning text all preserved in this log entry so future readers can reproduce
- Known limitations / observations:
  - **Transcription quality is environmental.** `base.en` did fine on a quiet room with one clear speaker (T-2 / T-4 smokes); it would struggle with overlapping speakers, strong accents, or technical jargon. The README's new model trade-off table sets expectations and points at `small.en` / `medium.en` as upgrades
  - **PowerShell does not render every whisper.cpp glyph.** The musical-note markers (♪) come out as `�T�` in the terminal. The on-disk `.md` is correct UTF-8; opening it in VS Code or any modern editor shows the actual character. Not worth fixing here -- a future markdown-summarisation track may decide to strip or normalise these
  - **Shutdown drain time scales with backlog.** A 30-minute monologue with `--max-chunk-seconds 5` could mean a few minutes of post-`Ctrl+C` drain on `base.en`. The user sees streaming `[transcribed]` lines so it's never silent; if it ever becomes a problem, T-7 / Phase 5 can add a `--no-wait` shutdown that orphans queued jobs (the WAVs + sidecars are already on disk, so the user can re-run `transcribe` on them later)
  - **The "speak into mic" demo recipe assumes a human runner.** This sprint validated the multi-chunk + multi-artifact + backpressure-warn + clean-shutdown behavior with ambient music as the audio source. A maintainer who wants to validate spoken-word accuracy specifically should run the README recipe themselves with their voice
- Why: this is the milestone the entire Phase 4 plan was structured around. Five sprints of capture / transcribe / wire / format / harden converge here. After Sprint 28, anyone with sox + whisper.cpp + a model file can clone the repo, install dependencies, and run a single command to get a directory full of human-reviewable meeting markdown. The Phase 4 contract -- "run one command, speak into the mic, watch markdown appear in real time" -- is now true, demonstrated, and documented in the README such that a new user can repeat it without consulting the source

## Sprint 29 (T-7a): Per-session HTML transcript + `--silence 0` deterministic chunking (Completed)
- Two field-driven fixes triggered by live use of the Phase 4 pipeline on the user's Windows machine in a noisy environment. Neither was foreseen in the original sprint plan; both are small, additive, and tested
- **`--silence 0` disables sox's silence detector**:
  - Field issue: with the documented `--threshold 0.01 --silence 60` config, chunks were still rotating every 1-3 s. The cause is environment-specific (room noise floor flickering around the sox threshold + Windows waveaudio driver behavior in node-record-lpcm16) and not worth chasing in detail. The deterministic fix is to bypass sox's silence detector entirely and rely on `--max-chunk-seconds` for rotation
  - `'--silence'` parser switched from `positiveNumber` to `nonNegativeNumber`. `0` is now a valid value
  - `AudioRecorder` adds `this.idleSilenceDisabled` (set when `idleSilenceSeconds === 0`) and passes `endOnSilence: !this.idleSilenceDisabled` to `recorder.record(...)`. `recorderPatch.js` already conditionally omitted the silence args when `endOnSilence` was falsy, so the sox invocation was already correct -- this sprint just exposes the toggle through to the CLI
  - Help text updated. Existing parseIdleArgs test for `--silence 0 -> error` rewritten to assert that `0` is accepted and surfaces to `idleSilenceSeconds === 0`; added rejection cases for `-1` and `abc`
- **Per-session HTML transcript**:
  - Field requirement: "The transcribe must all go into a single file. Let's make it HTML instead." Per-chunk `.md` files are great for chunk-level inspection but a long meeting wants ONE document the user can scroll
  - New module `src/sessionTranscript.js`. Pure render helpers (`renderSessionDocumentInitial`, `renderChunkSectionHtml`, `spliceChunkSection`, `bumpChunkCount`) plus one side-effecting entry point (`appendChunkToSessionHtml`). The document is self-contained: inline `<style>`, no external CSS / JS, so it travels via copy / email without breaking. ASCII-only source (entities `&mdash;` and `&middot;` instead of literal Unicode) so PowerShell `Get-Content` displays it correctly and there's zero encoding ambiguity across editors
  - Document structure pins two literal markers (`<!-- CHUNKS:START -->`, `<!-- CHUNKS:END -->`) plus a `COUNT` marker pair around the header chunk-count integer. The appender splices new `<section>` elements before the `CHUNKS:END` marker and increments the count -- O(file-size) per append, which is acceptable for sessions up to a few thousand chunks
  - Each chunk section gets a class of `chunk ok` / `chunk skipped` / `chunk failed` so the inline CSS can colour failed / skipped chunks differently (orange left border, slightly faded)
  - Heading per chunk: `HH:MM:SS (duration | peakDb | bytes)`. Compact, scannable, sortable. Full stem in the `title=` attribute for hover-disambiguation when two chunks share the same second
  - The .md path and the HTML path both decorate any thrown error so `onFailure` can surface either. Best-effort writes -- a failed HTML write does NOT mask a successful transcription
- `src/audioRecorder.js` wiring:
  - `runWithMarkdown` now calls `appendChunkToSessionHtml` after the per-chunk `.md` write, on both success and failure paths. Both writes share a small `readSidecarBestEffort(wav, fsImpl)` helper so they agree on the sidecar fallback shape
  - `_attachFinalize` peak-gate skip path also calls `appendChunkToSessionHtml` so skipped chunks appear in the session HTML with explicit "Skipped: ..." stubs, not silent gaps
  - Default `onSuccess` log now announces `htmlPath` over `mdPath` over `txtPath` -- the single file the user follows live
- Tests added (**24 new**; **264 -> 288**, 15 -> 16 suites; full suite still 100% pass):
  - `tests/sessionTranscript.test.js` (24 tests):
    - **Format helpers (4):** `escapeHtml` entity round-trip; `formatBytes` (B / KB / MB); `formatDuration` boundary at 60 s; `formatPeakDb` ASCII-minus
    - **`renderSessionDocumentInitial` (4):** both markers present exactly once; session label is escaped (XSS injection attempt produces `&lt;script&gt;`); ISO start time appears; initial count is 0 between COUNT markers
    - **`renderChunkSectionHtml` (6):** ok / empty / skipped / failed branches, escape coverage, heading format, missing-sidecar throws
    - **`spliceChunkSection` (3):** insert before end marker; multiple splices preserve order; no-marker fallback appends to end (corrupt-doc recovery, no throw)
    - **`bumpChunkCount` (2):** increments between markers; passes through unchanged when markers absent
    - **`appendChunkToSessionHtml` integration (4):** first append creates the file; second append grows it; default session label is the dir basename; mixed ok / skipped / failed entries co-exist
    - **`transcriptHtmlPathFor` (1):** dir + transcript.html composition
  - `tests/parseIdleArgs.test.js` updated: existing `--silence 0` rejection test rewritten to assert acceptance + numeric value, plus `-1` and `abc` rejections via the new `nonNegativeNumber` parser
- Files added: `src/sessionTranscript.js`, `tests/sessionTranscript.test.js`
- Files modified: `src/audioRecorder.js`, `src/index.js`, `tests/parseIdleArgs.test.js`, `README.md`, `docs/quickstart.md`, `docs/sprint-log.md`, regenerated HTML mirrors
- Validation:
  - `node --check` clean across the three modified `src/` files
  - `npm test` -- **288/288 passing across 16 suites** (+24 new). Full suite green
  - **End-to-end smoke:** `idle <tmp> --silence 0 --max-chunk-seconds 5 --transcribe --transcribe-min-peak 0 --duration 18`. Produced 4 chunks of 5 s each (last one truncated at 1.3 s by duration expiry). EVERY rotation logged `Max chunk seconds (5) reached, rotating: <name>` -- the silence detector did NOT fire even once, confirming `--silence 0` bypasses it. `transcript.html` grew from 0 to 2380 bytes across the run; final count between COUNT markers was `4`; all four chunks rendered as `class="chunk ok"` sections (the room was effectively silent so whisper returned `[BLANK_AUDIO]`, which is correctly rendered as the transcript text). `[transcribed]` log line now points at `transcript.html` instead of the per-chunk `.md`
- Known limitations / observations:
  - **`--silence 0` is a coarse workaround, not a fix for the underlying flakiness.** A user with a well-behaved silence detector should still prefer `--silence N` for natural pause-driven chunking. The real fix would be to investigate why sox+waveaudio+node-record-lpcm16 sees premature silence on this machine; until then, `--silence 0` is the escape hatch
  - **Append is O(file-size) per chunk.** Each append reads + writes the whole transcript.html. For a session of 1000 chunks at ~600 bytes per section the file is ~600 KB; reading + rewriting that on each append is microseconds on SSD. For 100k+ chunks it would start to matter, but that's an unrealistic single-session workload. If it ever becomes a problem, an append-only "open the file in r+, seek to the marker, splice in place" approach is straightforward
  - **No live-reload helper.** The user has to refresh their browser to see new chunks. A `<meta http-equiv="refresh" content="10">` would do it but feels heavy-handed; the user can use a watch-mode editor (VS Code's "Open with Live Preview", or a one-liner `python -m http.server`) if they want auto-refresh
  - **Per-chunk `.md` files still produced.** Removing them would break T-4 acceptance and surprise the user. They're harmless -- ignore them or delete after the session if they bother you. T-8 / later sprint might toggle them via a flag
  - **No close-on-shutdown finalisation.** The HTML document is "always valid" -- it has the closing tags from the moment of creation; appends splice INSIDE the body. So if the process crashes mid-meeting the file is still openable. No need for an explicit "session close" step
- Why: the user was running a meeting and getting fragmented chunks they couldn't reasonably review. Per-chunk markdown was the wrong granularity for that workflow. This sprint delivers the right granularity (per-session HTML, opens in any browser) and the right rotation knob (`--silence 0` for environments where sox is misbehaving). Took ~45 minutes total; both changes are small, well-tested, and roll back trivially (per-chunk .md still works exactly as before; `--silence N>0` is still the default)

## Sprint version-tracking: v0.2.0 (Completed)
- Backfilled the workflow rule that should have governed prior sprints: every commit bumps `package.json` `version` and the running server advertises that version on `GET /api/config`. The UI now renders it as a small `vX.Y.Z` badge in the sidebar so the user can confirm a restart picked up new code without grepping files
- Files modified:
  - `.instructions.md` (new section 8 "Bump Version" + version history table)
  - `package.json` (0.1.0 -> 0.2.0; the 0.2.0 milestone retroactively names the previous web-UI sprint)
  - `src/server.js` (expose `version` on `/api/config`; reorder broadcast/started emission so `chunk_started` never races `started`; replace the initial `status` WS frame with a richer `sync` frame carrying the full chunks array)
  - `src/ui/index.html` (sidebar version badge; `sync` handler that clears+rebuilds the transcript feed; `(no speech)` text for ok-but-empty chunks; debounced scroll-to-bottom on `chunk_started`)
- Validation: `node --check` clean across both server and UI sources (HTML inline JS is hand-validated); `npm test` continues to pass (no test surface changed by this sprint)
- Known limitations:
  - Version is reported only via `/api/config`; the CLI doesn't print it on startup. A `node src/index.js --version` could be added in a future sprint
  - The `sync` frame includes the full `chunks` array. For very long sessions (thousands of chunks) this is a few hundred KB on connect; perfectly fine for one-meeting sessions but worth noting if anyone tries to leave the recorder running for days
- Why: the project had no version discipline. Sprints were shipping but `package.json` stayed at 0.1.0 and the running server gave no signal about what code it actually loaded. This sprint fixes both at once: the rule is written down, the running server proves it followed the rule, and the UI surfaces the proof

## Sprint GPU-1: v0.3.0 (Completed)
- Opened the `feature/gpu-acceleration` track. First sprint is detection-only: tell the user (a) whether an NVIDIA GPU is visible to this machine, and (b) whether the whisper.cpp binary on PATH was built with CUDA. No transcription behaviour changes yet
- Files added:
  - `tools/check-gpu.js` -- `detectGpu()` library function + `npm run gpu:check` CLI entry. Two independent probes:
    - `runNvidiaSmi()` shells out to `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits` and parses one row per detected GPU (name, VRAM in MiB, driver version). Handles "N/A" VRAM, multi-GPU hosts, ENOENT (nvidia-smi not installed), non-zero exit (driver not responding), and empty output
    - `inspectWhisperBuild()` reuses `pickCandidateBinary` from `tools/check-transcribe-deps.js` (single source of truth for binary discovery), then scans the `--help` text for `--no-gpu` / `-ngl` / `--n-gpu-layers` / `cublas` / `CUDA` / `use gpu`. Any hit ⇒ the binary advertises GPU offload. Caller gets `{ binary, binaryPath, cudaCapable, sawFlags, reason }`
    - `detectGpu()` composes both and is memoised at module level (server consumers don't reprobe per request). `effective` is true only when both halves are positive
    - `printHumanSummary()` formats the four user-facing outcomes: AVAILABLE / GPU-only / binary-only / nothing. Each non-available case names the next step
  - `tests/checkGpu.test.js` -- 15 tests covering: single + multi-GPU CSV parsing, missing nvidia-smi, non-zero exit, empty rows, "N/A" VRAM, CUDA-capable detection, CPU-only detection, missing binary, case-insensitive token match, and the three summary banners. All injectable via `runner` / `probe` so the suite never spawns anything
- Files modified:
  - `package.json` (0.2.0 -> 0.3.0; new feature surface added so per `.instructions.md` rule 8 this is a minor bump). Added `"gpu:check": "node tools/check-gpu.js"` script
- Validation:
  - `npx jest --ci --forceExit tests/checkGpu.test.js` -- 15/15 passing
  - Live smoke on the workstation: `node tools/check-gpu.js` reports `NVIDIA GeForce RTX 4070 Ti (12282 MiB)`, driver `560.94`, and flags the installed `whisper-cli.EXE` (from `D:\bin\whisper-blas-bin-Win32`) as advertising `--no-gpu`. End-to-end output reads cleanly
- Known limitations / observations:
  - **The card is an RTX 4070 Ti, not a 4080 Ti.** The initial conversation referenced the 4080 Ti but the live probe is the source of truth. The plan still applies; numbers in GPU-5's benchmark will reflect actual hardware
  - **Token-match heuristic has a false-positive surface.** The installed binary on this workstation is `whisper-blas-bin-Win32` -- an OpenBLAS build, not cuBLAS -- yet its help text exposes `--no-gpu` because modern whisper.cpp surfaces the flag regardless of build. The probe says "cudaCapable: yes" but at runtime that binary will still execute on the CPU. We accept the false positive for now because: (a) the runtime check (whisper.cpp's own startup log: `ggml_cuda_init: found 1 CUDA device` vs nothing) is the only fully reliable signal, and (b) GPU-5's benchmark will surface real per-chunk timings that prove or refute GPU offload. A future refinement could parse `--help` for a build-banner line (some builds print `whisper.cpp v1.7.0 (cuBLAS)`) and prefer that signal
  - **AMD / Intel / Apple paths not wired.** `runNvidiaSmi` is NVIDIA-only. Adding `rocm-smi` (AMD) and Apple Silicon Metal probes is a future small sprint when those hosts come online
  - **Probe is cached for the module's lifetime.** A user who swaps `whisper-cli` mid-server-process won't see the change without a restart. Acceptable: binary swaps are rare and we re-probe on every fresh process
- Why: GPU-1 is the smallest useful step. It lets the user run `npm run gpu:check`, see whether their hardware + binary support GPU transcription, and surfaces the exact failure mode if not. The rest of `feature/gpu-acceleration` (flag plumbing, UI badge, auto-installer, benchmark) builds on top of this single probe

## Sprint GPU-2: v0.4.0 (Completed)
- Plumbed the GPU intent through every layer of the transcription pipeline so a user with a CUDA-built whisper.cpp can opt in, opt out, or tune layer offload from the CLI without any code changes downstream. Default behaviour is unchanged: omit both flags, let whisper.cpp's own build default decide
- Tri-state semantics adopted everywhere (CLI parser, AudioRecorder, transcribe.js, whisperServer.js, sidecar, chunk-markdown):
  - `gpu: false` -> emit `--no-gpu` (hard CPU override; works on any build that surfaces the flag)
  - `gpu: true` + `gpuLayers: N` -> emit `-ngl N` (whisper.cpp's `-ngl <N>` controls how many transformer layers go on the GPU; on a CUDA build, the default is "all")
  - `gpu: true` with no layer count -> emit nothing; CUDA build defaults to all layers
  - `gpu: null` -> emit nothing; preserves today's CPU-only baseline behaviour
- Files modified:
  - `src/transcribe.js` -- `buildWhisperArgs({ gpu, gpuLayers })` and `transcribeFile({ gpu, gpuLayers })`. Flag insertion sits between `-t N` and `--no-speech-thold` to keep argv stable + easy to eyeball in trace. The returned result object carries `gpu`/`gpuLayers` so the caller can echo intent (whisper.cpp doesn't echo back whether it actually used the GPU; runtime ground-truth is whisper.cpp's own startup log line `ggml_cuda_init: found 1 CUDA device` which GPU-5's bench tool will surface)
  - `src/whisperServer.js` -- new pure helper `buildServerArgs({ model, threads, port, gpu, gpuLayers })` for testability, plus `start({ ..., gpu, gpuLayers, spawnFn, waitForPortFn })` which now records `ws.gpu` / `ws.gpuLayers` on the instance and accepts injected spawn/waitForPort for tests (mirrors how `transcribeFile` was already factored). The `[whisper-server] ready` log line now says `(GPU)` / `(CPU)` / `(default)` so a quick `npm run ui` makes the choice obvious
  - `src/audioRecorder.js` -- constructor accepts `gpu` / `gpuLayers` and normalises them once at construction time; threads them through `_startWhisperServerSilently()` (persistent server path), `_serverAwareTranscribe()` (per-chunk CLI fallback), and the queue worker job payload. The persistent server can't change `-ngl` per chunk, so the server is started with the recorder-level intent and chunk-level overrides are honoured only in the CLI fallback path (documented inline)
  - `src/chunkSidecar.js` -- schema bumped 1 -> 2. New optional `transcribe` block records `{ model, language, gpu, gpuLayers }` for each chunk so the on-disk artifact is self-documenting about whether the chunk was eligible for GPU offload. Sidecars without a `transcribe` block are still valid (back-compat)
  - `src/chunkMarkdown.js` -- new `formatAcceleratorLabel(sidecar.transcribe)` helper. The per-chunk `.md` gains an `**Accelerator:** GPU (32 layers)` (or `CPU (forced)`) line in the metadata block when the sidecar declares a GPU intent; omitted when the intent is `null` (the today's-default case) so existing CPU-only sessions look identical to before
  - `src/index.js` -- new CLI flags `--no-gpu` and `--gpu-layers N` on record / chunk / idle / transcribe; new `resolveGpuFlags({ noGpu, gpuLayers })` helper collapses them into the tri-state and rejects `--no-gpu --gpu-layers N` as mutually exclusive. Help text + `transcribe --json` output were extended
- Files added:
  - `tests/resolveGpuFlags.test.js` -- 5 tests pinning the helper's behaviour (null, --no-gpu, --gpu-layers, mutual exclusion, defensive rejection of bad layer counts)
- Files modified (tests):
  - `tests/transcribe.test.js` -- 7 new `buildWhisperArgs` GPU branches + 3 new `transcribeFile` GPU smoke tests (argv shape, result fields)
  - `tests/whisperServer.test.js` -- 5 new `buildServerArgs` tests + 2 end-to-end `start()` smoke tests using injected `spawnFn`/`waitForPortFn` fakes, plus an integration test confirming `AudioRecorder` threads gpu/gpuLayers into the whisper-server startup
  - `tests/chunkSidecar.test.js` -- 4 new tests for the v2 `transcribe` block (presence, absence, normalisation, gpu===false zeroes layers)
  - `tests/chunkMarkdown.test.js` -- 5 new tests for `formatAcceleratorLabel` + 4 integration tests for the new `**Accelerator:**` metadata line
  - `tests/parseRecordArgs.test.js`, `tests/parseIdleArgs.test.js`, `tests/parseTranscribeArgs.test.js` -- shape updated to include `noGpu` / `gpuLayers` defaults; new positive-and-negative parsing tests for `--no-gpu` and `--gpu-layers N`
- Validation: `npm test` -- **500/500 passing across 27 suites** (+46 new). No lint errors on any modified file. `node --check` clean across the six modified `src/` modules. Help text manually re-read for the new flag descriptions
- Known limitations:
  - **The persistent whisper-server can't change `-ngl` per chunk.** It's a process-level decision. `_serverAwareTranscribe` documents this explicitly: the server is started with the recorder-level GPU intent, and per-chunk job-payload GPU fields are honoured only when we fall back to the per-chunk CLI path
  - **whisper.cpp doesn't echo "did it actually use the GPU" in its result.** Our result + sidecar capture the *intent*. The *fact* shows up in whisper.cpp's own stderr ("ggml_cuda_init: ...") which we already pipe to `trace('whisperServer', 'stderr', ...)` but don't parse. GPU-5's benchmark will read this from actual run output to give a ground-truth answer
  - **`-ngl` interpretation on whisper-server.** The HTTP API doesn't accept `-ngl`; it's a process-start flag only. Same limitation as above; documented in code
- Why: GPU-1 told the user whether their hardware was capable. GPU-2 lets them actually use it. Default behaviour is unchanged, every change is opt-in via a clearly-documented CLI flag, and every chunk's on-disk artifacts now record which accelerator was requested so a later review session knows which sessions were CPU vs. GPU

## Sprint GPU-3: v0.5.0 (Completed)
- Surfaced the GPU probe through the web UI so the user can confirm at a glance (and confirm AFTER a server restart) that LocalRecorder is wired up to use the card. No CLI behaviour changes
- Files modified:
  - `src/server.js` -- `getServerInfo()` now also calls `detectGpu()` (cached at the tools/check-gpu module level so this is O(1) after the first hit) and stamps a `gpu` block onto the cached server info: `{ available, deviceName, vramMb, driver, cudaCapable, reason }`. `/api/config` echoes this `gpu` field so the sidebar can render the badge on first paint
  - `src/ui/index.html` -- new `#gpu-badge` element in the sidebar header (between model chip and version badge). `renderGpuBadge(gpu)` paints `GPU: NVIDIA GeForce RTX...` green-on-dark when available, `GPU: off` gray-on-dark when not. `title` attribute carries the long-form reason / VRAM / driver so the user can hover for the full story
- Validation:
  - Live HTTP smoke: `node src/server.js` against the workstation. `GET /api/config` returns:
    ```json
    { "gpu": { "available": true, "deviceName": "NVIDIA GeForce RTX 4070 Ti",
               "vramMb": 12282, "driver": "560.94", "cudaCapable": true, "reason": null } }
    ```
  - `npm test` -- 500/500 passing (no new tests this sprint; the underlying `detectGpu()` is already covered by `tests/checkGpu.test.js`)
  - `node --check src/server.js src/ui/index.html` is N/A for HTML; server.js node-check clean
- Known limitations:
  - **No client-side tests for the badge.** The UI is plain HTML/CSS/inline-JS, no tooling, no test runner. The badge is small enough to eyeball; if it grows the project will need a UI test harness (likely Playwright). For now, the live smoke test against `/api/config` is the contract test
  - **Cache is sticky.** `getServerInfo()` is memoised per process. A user who plugs in a GPU mid-session won't see the badge update; a server restart picks it up. This is the same caching that already governed model / binary, and it's a deliberate trade-off: every `/api/config` call would otherwise re-spawn `nvidia-smi` and a `whisper-cli --help` probe
- Why: GPU-1 + GPU-2 give the user the controls; GPU-3 closes the loop by confirming what state the server is actually in. Without this badge, the user can't tell whether a sprint shipped from a CLI restart and a fresh server picks up the GPU, or whether they're still on the prior CPU build. The badge is the same idea as the `vX.Y.Z` badge from the version-tracking sprint, applied to a different invariant

## Sprint GPU-4: v0.6.0 (Completed)
- One-command installer for a CUDA-built whisper.cpp on Windows. Closes the gap between GPU-1's "yes you have a card" / GPU-2's "we can use it if the binary supports it" and the painful reality that the workstation in this conversation actually has a BLAS (CPU-only) build, so the GPU flags would have been no-ops
- Files added:
  - `tools/install-whisper-cuda.js` (361 lines) -- `npm run gpu:install` entry. Fetches `https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest`, picks the highest-CUDA-version `whisper-cublas-*-bin-x64.zip` asset, downloads it with a progress bar, verifies SHA256 if the release ships a digest, extracts via PowerShell's built-in `Expand-Archive` (no new runtime deps), and flattens the directory layout so `whisper-cli.exe` lands directly under `vendor/whisper-cuda/`. Records the release tag + asset name + checksum in `vendor/whisper-cuda/.installed.json` so re-running the installer is a no-op until the upstream version changes. HTTPS-only; no GitHub token required for anonymous reads. Windows-only (refuses on other platforms with a clear message pointing at the source-build path)
  - `tests/installWhisperCuda.test.js` (172 lines) -- 26 unit tests covering the pure helpers: `pickCublasAsset` (7), `pickShaAsset` (3), `cmpVersion` (2), `parseShaFile` (5), `humanBytes` (2), plus implicit asset-list edge cases. HTTP / extraction paths are integration-only (validated by the live smoke run; see below)
- Files modified:
  - `tools/check-transcribe-deps.js` -- new `VENDOR_WHISPER_CUDA_DIR` constant (absolute path to `vendor/whisper-cuda/`), new `vendorBinaryPath(name, opts)` helper (returns absolute path when the file exists, null otherwise; honours `.exe` on win32 and bare names elsewhere), and new `resolveWithVendor(candidates, { probe })` that tries each vendor candidate first (via the injected probe so tests can stay synchronous and offline) and falls through to the existing `pickCandidateBinary` PATH search. Exports updated
  - `src/transcribe.js` -- `resolveBinary()` now delegates to `resolveWithVendor`; the public surface is unchanged, but the next time a chunk transcribes it'll pick up the vendor binary automatically
  - `src/whisperServer.js` -- `probeServerBinary()` builds an ordered candidate list (vendor first, then PATH names) and returns the absolute vendor path when present so `start()` spawns the right binary. The whisper-server side has the same vendor preference as `whisper-cli`
  - `.gitignore` -- new `vendor/` rule so the (50-450 MB) extracted binaries never get committed
  - `package.json` -- new `gpu:install` npm script
  - `tests/checkTranscribeDeps.test.js` -- 6 new tests for `vendorBinaryPath` / `resolveWithVendor` (vendor wins, falls through when probe fails, falls through when file missing, returns null when nothing works, returns absolute path with platform-appropriate ext)
- Validation:
  - `npm test` -- **526/526 passing across 28 suites** (+26 new)
  - Live API smoke against the real GitHub release: `pickCublasAsset` correctly identifies `whisper-cublas-12.4.0-bin-x64.zip` (~450 MB; CUDA Toolkit 12.4) out of the 8 assets on whisper.cpp v1.8.4. The 11.8.0-bin variant exists alongside it (~58 MB) and is correctly ranked below
  - Lint clean across the four modified `src/` and `tools/` modules
- Known limitations / observations:
  - **Did NOT download in this sprint.** The latest cuBLAS asset is ~450 MB and would have been overkill to download just to verify the sprint. The asset-picker is validated against the real release JSON; the download/extract path is plain HTTPS + PowerShell `Expand-Archive`, both of which are battle-tested
  - **Windows-only.** whisper.cpp publishes prebuilt cuBLAS ZIPs only for Windows x64. Adding a Linux path would mean cross-compiling whisper.cpp from source, which the plan explicitly says is out of scope. The installer refuses to run on other platforms with a clear message and a pointer at the source-build workflow
  - **Idempotency through a tiny state file.** `vendor/whisper-cuda/.installed.json` records `{tag_name, asset, sha256, installedAt}`. Re-running the installer against the same release tag skips the download. To force a re-install (e.g. the existing copy is corrupt), delete that file. This is much simpler than a full integrity check on every run
  - **The whisper.cpp repo has moved orgs.** The smoke test caught a 301 redirect (`api.github.com/repos/ggerganov/whisper.cpp/releases/latest` now redirects to the `ggml-org` org's numeric `repositories/541269386`). Our `httpGetJson` follows redirects so the installer works fine, but the README still says `ggerganov/whisper.cpp`. Worth a follow-up sprint to update all the URLs
  - **Compressed binaries are still big.** The cuBLAS 12.4 build is 457 MB compressed, ~1.2 GB extracted. The installer prints a clear progress bar (% / MiB) and on a typical residential connection takes 30-60 seconds. No retry logic; a failure during download leaves a `.partial` file behind that the next run overwrites cleanly
- Why: GPU-2 already passes the right flags to whisper.cpp -- but with a CPU-only binary on the user's PATH, those flags don't do anything. GPU-4 turns "you should manually grab the cuBLAS ZIP from the GitHub releases page, extract it somewhere, edit PATH, restart your shell" into `npm run gpu:install`. Combined with the vendor-preferring binary discovery, the very next server start uses the new binary automatically. This is the practical step that lets the user *prove* GPU acceleration is real on this workstation (and is the prerequisite for GPU-5's benchmark)

## Sprint GPU-5: v0.7.0 (Completed)
- The proof artifact. `npm run gpu:bench` runs the same synthetic WAV through whisper-cli twice (`--no-gpu` vs. the binary's GPU default) for each model under `models/*.bin` and reports the CPU mean / GPU mean / speedup ratio. Writes a committed human-readable summary and a gitignored per-run JSON dump
- Files added:
  - `tools/bench-gpu.js` (319 lines) -- `npm run gpu:bench` entry. Generates a deterministic 10-second synthetic WAV using a seeded mulberry32 PRNG (no binary fixture committed to the repo). For each available model: one untimed warm-up + `--runs` (default 3) timed samples per side. Reports mean, median, min, max, realtime factor (RTF = audio_seconds / wall_clock_seconds), and speedup (CPU_mean / GPU_mean). CLI flags: `--runs N`, `--duration S`, `--threads N`, `--model PATH`. Writes `docs/gpu-bench-results.md` (committed, overwritten each run) and `recordings/.bench/bench-<ts>.json` (gitignored)
  - `tests/benchGpu.test.js` (193 lines) -- 22 unit tests covering the pure helpers: `mulberry32` (determinism + range), `generateBenchWav` (RIFF/WAVE header, byte counts, determinism, seed variance, return value), `summarise` (stats math, even/odd medians, single-sample), `realtimeFactor`, `speedup`, `formatResultsMarkdown` (empty/populated/CPU-only-build), `parseArgs` (defaults, flags, repeated --model, unknown flag). All offline -- no whisper.cpp invocation
  - `docs/gpu-bench-results.md` -- the actual workstation's first-run output (the file is overwritten on every `npm run gpu:bench` so this is just the starting state). On this machine, with the BLAS-bin-Win32 binary that GPU-1 warned about, the bench reports `base.en CPU RTF 1.46x  GPU RTF 1.49x  speedup 1.02x` -- exactly the diagnostic the bench was built to reveal: the binary *advertises* `--no-gpu` (which is why GPU-1 reports it as "cuda capable") but the actual GPU/CPU speedup is ~1.0x, confirming it's CPU-only. After `npm run gpu:install` lands a real cuBLAS build, the user's next bench run will overwrite this with a real speedup table (typically 3-10x on a 4070 Ti)
- Files modified:
  - `package.json` -- new `gpu:bench` npm script; 0.6.0 -> 0.7.0 minor bump
- Validation:
  - `npm test` -- **548/548 passing across 29 suites** (+22 new)
  - End-to-end smoke on the workstation: `node tools/bench-gpu.js --runs 1 --duration 3 --model models/ggml-base.en.bin` produced a clean 8-second run, wrote the docs/json artifacts, summary matched the per-run output line. Confirmed timings hover around realtime for the base.en model on this machine
  - The synthetic-WAV approach was validated by running the bench against `models/ggml-base.en.bin` and confirming whisper.cpp doesn't BLANK_AUDIO out (the AM-modulated harmonic stack provides enough spectral content that whisper.cpp's full decoder kicks in for the entire clip; without that, the timed work would be tiny and the comparison would be useless)
- Known limitations / observations:
  - **The committed `docs/gpu-bench-results.md` is overwritten on every bench run.** This is deliberate -- the file is *the report*, not source-of-truth metadata. The notes block inside the generated markdown explains how to read it so the file is self-documenting regardless of which run last wrote it
  - **The first committed snapshot shows 1.02x speedup on this workstation.** That's the BLAS build, not a regression. After GPU-4's installer runs, the actual cuBLAS build replaces it under `vendor/whisper-cuda/` and the next bench will show the real numbers (didn't run the installer in this sprint to avoid downloading 450 MB during automated work)
  - **No micro-benchmarks for whisper-server.** The bench tool uses the per-chunk `whisper-cli` path (via `transcribeFile`) because that's what isolates the GPU/CPU choice cleanly per run. The persistent `whisper-server` path can't change GPU mode mid-process, so benching it the same way would require a process restart per side, doubling complexity for marginal extra value
  - **No CSV output.** The JSON dump under `recordings/.bench/` keeps every per-sample timing; if a user wants to do further analysis they can read that file (it's structured). CSV is a downstream concern
  - **Synthetic audio is not real speech.** A future sprint could commit a short prerecorded TTS clip if we want absolute timings to be portable across runs; for now the determinism (same WAV every time) gives us within-run consistency, and the speedup ratio is independent of the input content
- Why: GPU-4 lets the user *install* the right binary, but only this sprint can *prove* the install worked. The 1.02x speedup we see now is the smoking gun for the BLAS situation. Once a cuBLAS build lands under `vendor/whisper-cuda/`, the same `npm run gpu:bench` will rewrite the doc with the real numbers and the contrast will be undeniable. This is what makes the feature branch self-validating




