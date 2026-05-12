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