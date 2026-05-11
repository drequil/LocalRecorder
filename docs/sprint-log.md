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

Next: Phase 3 - Transcription (chunked Whisper integration). A roadmap sprint to formalize Phases 3-10 in a dedicated `docs/sprint-plan.md` is also worth scheduling.