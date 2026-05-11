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

Next: Phase 3 - Transcription (preceded by a stabilization sprint to fix the broken `src/audioRecorder.js`)