# LocalRecorder

A local-first AI memory and workflow assistant that records audio, transcribes it locally, summarizes content hierarchically, and stores everything in searchable markdown for privacy and offline operation.

## Project Goals

- **Local Audio Recording**: Capture audio with low-power idle listening.
- **Chunked Transcription**: Process long recordings using Whisper for offline transcription.
- **Local Summarization**: Generate hierarchical summaries (hour → day → 2.5 days → week → 2 weeks → month → quarter) without data loss.
- **Markdown Persistence**: Store transcripts and summaries in human-reviewable markdown files.
- **Searchable Memory**: Enable keyword/topic search across all summary levels.
- **Heat/Trend Analysis**: Detect trends and generate periodic reports.
- **Periodic Summaries**: Automated generation at all time scales.
- **GPU Acceleration**: Optimize for local GPU where available.
- **Human Reviewability**: Transparent, auditable processes with audit logs and review interfaces.
- **Rolling Audio Management**: Delete audio files only after secure transcripts and summaries.

## Architecture Principles

- **Privacy**: All processing local, no cloud dependencies.
- **Offline Operation**: Fully functional without internet.
- **Incremental Scalability**: Grow without redesign.
- **Local GPU Acceleration**: Leverage hardware for performance.
- **Human Reviewability**: Transparent and explainable.

## Setup

1. Ensure Node.js is installed (Windows-compatible).
2. Run `npm install` to install dependencies.
3. Install **sox** — required for audio capture (see Audio Capture Prerequisites below).
4. Run `npm run audio:check` to verify sox is callable from this project.
5. Install **whisper.cpp** if you plan to use the `transcribe` subcommand (or any later Phase 4+ feature). Run `npm run transcribe:check` to verify. See Transcription Prerequisites below.
6. Download at least one ggml model (e.g. `ggml-base.en.bin`) into `./models/` before running `transcribe`. See the Transcription Prerequisites section for the link.
7. See individual modules for usage.

## Audio Capture Prerequisites

LocalRecorder uses [`node-record-lpcm16`](https://www.npmjs.com/package/node-record-lpcm16), which shells out to **sox** for the actual audio capture. Sox is not an npm package and must be installed separately and placed on your `PATH`.

Quick verification:

```bash
npm run audio:check
```

That script prints the detected sox version on success, or platform-specific install hints on failure.

### Windows

- `winget search sox` to find the current package id, then `winget install <id>`
- or `choco install sox.portable`
- or download manually from <https://sourceforge.net/projects/sox/files/sox/>

After install, ensure the sox folder (typically `C:\Program Files (x86)\sox-X.Y.Z\`) is on your `PATH`, then open a new shell so the change takes effect.

### macOS

```bash
brew install sox
```

### Linux

```bash
sudo apt install sox       # Debian/Ubuntu
sudo dnf install sox       # Fedora
sudo pacman -S sox         # Arch
```

## Transcription Prerequisites

> Required for the `transcribe` subcommand (and Phase 4+ features). [whisper.cpp](https://github.com/ggerganov/whisper.cpp) ships a CLI binary that LocalRecorder shells out to per WAV.

Quick verification:

```bash
npm run transcribe:check
```

The probe tries three binary names in order (`whisper-cli`, `whisper`, `main`) and prints the resolved path + version on success, or platform-specific install hints + a non-zero exit on failure.

### Model file

In addition to the binary, whisper.cpp needs a ggml model file. Download one (or more) into `./models/`:

- `ggml-base.en.bin` (~141 MB) — sensible default; fast on CPU, English-only. <https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin>
- Other sizes (`tiny.en`, `small.en`, `medium.en`, `large-v3`) are listed at <https://huggingface.co/ggerganov/whisper.cpp/tree/main> — bigger = more accurate but slower and more RAM.

If you store models elsewhere, pass the path via `--model <path>`.

### Windows

There is no winget package for whisper.cpp yet. Install via the GitHub releases:

1. Download a release ZIP from <https://github.com/ggerganov/whisper.cpp/releases>.
2. Extract it (for example to `C:\Tools\whisper.cpp\`).
3. Add the folder containing `whisper-cli.exe` to your user or system `PATH`.
4. Open a new shell so the change takes effect.

### macOS

```bash
brew install whisper-cpp   # Homebrew exposes the binary as `whisper-cli`
```

### Linux

Some distributions ship a `whisper.cpp` package; check your package manager first. Otherwise build from source:

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
# Put the built `whisper-cli` (or `main`, on older releases) on your PATH.
```

## Usage

The CLI lives at `node src/index.js`. Run with no arguments (or `help`) for the full list of subcommands and flags.

```bash
node src/index.js devices
# List audio input devices visible to sox.

node src/index.js listen [--device <id>]
# Live peak-level meter (no file written). Useful for confirming the mic is picking up sound.

node src/index.js record [<out.wav>] [--name <label>] [--root <dir>] [--duration N] [--device <id>]
# Record one WAV (+ sidecar JSON). Stops on Ctrl+C, or automatically after --duration seconds.

node src/index.js idle [<directory>] [--name <label>] [--root <dir>] [--duration N]
                      [--threshold P] [--silence N] [--device <id>] [--max-chunk-seconds N]
                      [--transcribe] [--model <path>]
# Per-silence WAV chunks plus JSON sidecars into a structured session directory.
# With --transcribe, each chunk is auto-transcribed via whisper.cpp the moment
# its WAV is finalised; the transcript lands as <basename>.txt AND a human-
# reviewable <basename>.md (metadata + transcript) is written next to the .wav.
# Transcriptions run serially through an in-memory queue so two long chunks
# don't fight for CPU. On failure, the .md is still written with a stub
# explaining what went wrong.

node src/index.js transcribe <file.wav> [--model <path>] [--json]
# Transcribe one WAV via whisper.cpp. Prints the transcript text (or a JSON
# payload with --json). Requires whisper.cpp on PATH and a ggml model file.
```

### Output layout

By default both `record` and `idle` write under `./recordings/`, into a session sub-directory:

| Mode | Flags | Resulting path |
|---|---|---|
| `record` | `--name meeting` | `recordings/meeting/meeting-YYYYMMDD-HHMMSS.wav` (+ `.json`) |
| `record` | _(none)_ | `recordings/YYYY-MM-DD/recording-YYYYMMDD-HHMMSS.wav` (+ `.json`) |
| `record` | explicit `out.wav` | written literally; `--name`/`--root` ignored |
| `idle` | `--name meeting` | `recordings/meeting/chunk-YYYYMMDD-HHMMSS-mmm.wav` (+ `.json`) |
| `idle` | _(none)_ | `recordings/YYYY-MM-DD/chunk-YYYYMMDD-HHMMSS-mmm.wav` (+ `.json`) |
| `idle` | explicit `<directory>` | chunks written into the directory verbatim |

`--root <dir>` overrides the `./recordings` default. Names are slugified (`Team Meeting!` → `Team-Meeting`); path-traversal patterns (`..`) are neutralised.

### Flag reference

| Flag | Subcommand | Type | Description |
|---|---|---|---|
| `--duration N` | record / idle | seconds | Stop after N seconds of wall clock. ~0.4 s of sox startup latency on Windows. |
| `--name <label>` | record / idle | string | Session label; selects the `recordings/<label>/` sub-directory. |
| `--root <dir>` | record / idle | path | Override the `./recordings` root. |
| `--device <id>` | listen / record / idle | string | Audio input device. Default is `0` on Windows. Use `devices` to enumerate. |
| `--threshold P` | idle | percent (0..100) | Silence detection threshold. Default `0.5`. Lower = more sensitive. |
| `--silence N` | idle | seconds | Silence duration before a chunk rotates. Default `1.0`. |
| `--max-chunk-seconds N` | idle | seconds | Force-rotate after N seconds even if the user is still talking. Off by default. |
| `--transcribe` | idle | flag | Auto-transcribe each chunk on rotation; writes `<basename>.txt` sibling to the WAV. Requires whisper.cpp + model. Off by default. |
| `--model <path>` | idle / transcribe | path | Path to a whisper.cpp ggml model. Default: `./models/ggml-base.en.bin`. For `idle`, only used when `--transcribe` is also set; failing existence check before capture starts. |
| `--json` | transcribe | flag | Emit a JSON payload (`{ text, model, wav, durationMs, binary, txtPath, version, versionLabel }`) instead of plain text. |

### Per-chunk artifacts

In `idle` mode each chunk produces:

| File | Always | Description |
|---|---|---|
| `<basename>.wav` | yes | The captured audio (16 kHz mono 16-bit signed PCM). |
| `<basename>.json` | yes | Sidecar metadata (schema v1): `{ version, wav, start, end, durationMs, audio, peak, peakDb, bytes }`. Empty placeholder chunks (sox waiting for audio that never arrived) are auto-deleted along with their sidecar slot. |
| `<basename>.txt` | only with `--transcribe` | Verbatim whisper.cpp transcript. Empty file for silent / sub-threshold chunks (the transcript is genuinely empty, not missing). |
| `<basename>.md` | only with `--transcribe` | Human-reviewable: heading with timestamp, metadata block, links to the three sibling files, transcript section. On transcription failure the `.md` is still written with a `_Transcription unavailable: <reason>_` stub so you never lose context for a chunk. |

### Example — leave it running for an hour

```bash
node src/index.js idle --name meeting --duration 3600 --threshold 0.5 --silence 20
```

That records up to 1 hour of meeting audio into `recordings/meeting/`, rotating to a new WAV+JSON pair every time you go silent for 20 s. Ambient noise below ~0.5% peak is filtered out.

### Example — record and transcribe one WAV

```bash
node src/index.js record hello.wav --duration 5
# (speak "this is a test" into the mic)

node src/index.js transcribe hello.wav
# this is a test
```

Whisper.cpp writes a sibling `.txt` next to the input WAV (current builds use `<wav>.txt`; older builds used `<basename>.txt`). LocalRecorder tolerates either convention and prints the resulting text. With `--json` the same call emits a structured payload including the resolved binary, model path, and processing time.

### Example — idle with auto-transcription

```bash
node src/index.js idle --name meeting --duration 3600 --threshold 0.5 --silence 20 --transcribe
```

Same chunk-on-silence behaviour as the plain `idle` example above, but each
chunk gets a `<basename>.txt` transcript written next to its `.wav` and
`.json` the moment whisper.cpp finishes (typically within a few seconds of
rotation on CPU). Transcriptions run serially through an in-memory queue, so
two long chunks in a row will queue rather than fight for CPU. On `Ctrl+C`
or when `--duration` expires, the recorder waits for any queued transcripts
to finish before exiting -- you won't lose the tail of a meeting just
because you stopped capture early. If `--model <path>` is omitted, the
default `./models/ggml-base.en.bin` is used; missing-model paths fail fast
before capture starts.

## Development

Follow MDM (Markdown-Driven Development) workflow with incremental sprints. Each sprint ends with commit, validation, and documentation update.