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
5. (Optional, for upcoming transcription) install **whisper.cpp** and run `npm run transcribe:check`. See Transcription Prerequisites below; not yet required by the CLI.
6. See individual modules for usage.

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

> Status: **upcoming — not yet required by the CLI.** Phase 4 (the transcription track, starting with T-1) needs a [whisper.cpp](https://github.com/ggerganov/whisper.cpp) CLI on `PATH`. The probe is wired in early so you can install ahead of time without surprises.

Quick verification:

```bash
npm run transcribe:check
```

The probe tries three binary names in order (`whisper-cli`, `whisper`, `main`) and prints the resolved path + version on success, or platform-specific install hints + a non-zero exit on failure.

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
# Per-silence WAV chunks plus JSON sidecars into a structured session directory.
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

### Sidecar JSON

Each WAV gets a matching `<basename>.json` sidecar (schema v1) with `{ version, wav, start, end, durationMs, audio, peak, peakDb, bytes }`. Empty placeholder chunks (sox waiting for audio that never arrived) are auto-deleted along with their sidecar slot.

### Example — leave it running for an hour

```bash
node src/index.js idle --name meeting --duration 3600 --threshold 0.5 --silence 20
```

That records up to 1 hour of meeting audio into `recordings/meeting/`, rotating to a new WAV+JSON pair every time you go silent for 20 s. Ambient noise below ~0.5% peak is filtered out.

## Development

Follow MDM (Markdown-Driven Development) workflow with incremental sprints. Each sprint ends with commit, validation, and documentation update.