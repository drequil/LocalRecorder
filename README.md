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
5. See individual modules for usage.

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

## Usage

The CLI lives at `node src/index.js`. Run with no arguments (or `help`) for the full list of subcommands and flags.

```bash
node src/index.js devices
# List audio input devices visible to sox.

node src/index.js listen [--device <id>]
# Live peak-level meter (no file written). Useful for confirming the mic is picking up sound.

node src/index.js record <out.wav> [--duration N] [--device <id>]
# Record one WAV. Stops on Ctrl+C, or automatically after --duration seconds.

node src/index.js idle <directory> [--threshold P] [--silence N] [--device <id>] [--max-chunk-seconds N]
# Per-silence WAV chunks plus JSON sidecars into <directory>.
```

### Flag reference

| Flag | Subcommand | Type | Description |
|---|---|---|---|
| `--duration N` | record | seconds | Stop after N seconds of wall clock. ~0.4 s of sox startup latency on Windows. |
| `--device <id>` | listen / record / idle | string | Audio input device. Default is `0` on Windows. Use `devices` to enumerate. |
| `--threshold P` | idle | percent (0..100) | Silence detection threshold. Default `0.5`. Lower = more sensitive. |
| `--silence N` | idle | seconds | Silence duration before a chunk rotates. Default `1.0`. |
| `--max-chunk-seconds N` | idle | seconds | Force-rotate after N seconds even if the user is still talking. Off by default. |

### Idle output

Each silence-delimited chunk becomes two files in `<directory>`:

- `chunk-YYYYMMDD-HHMMSS-mmm.wav` — Whisper-aligned 16 kHz mono 16-bit signed PCM
- `chunk-YYYYMMDD-HHMMSS-mmm.json` — sidecar (schema v1) with `{ version, wav, start, end, durationMs, audio, peak, peakDb, bytes }`

Empty placeholder chunks (sox waiting for audio that never arrived) are auto-deleted.

## Development

Follow MDM (Markdown-Driven Development) workflow with incremental sprints. Each sprint ends with commit, validation, and documentation update.