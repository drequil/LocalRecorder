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
| `--transcribe` | idle | flag | Auto-transcribe each chunk on rotation; writes `<basename>.txt` + `<basename>.md` siblings to the WAV. Requires whisper.cpp + model. Off by default. |
| `--model <path>` | idle / transcribe | path | Path to a whisper.cpp ggml model. Default: `./models/ggml-base.en.bin`. For `idle`, only used when `--transcribe` is also set; failing existence check before capture starts. |
| `--transcribe-min-peak P` | idle | number 0..1 (or 0..100 as %) | Skip chunks whose sidecar `peak` is below P (dead-air gate). Default `0.005` (~−46 dBFS). Skipped chunks still get a `.md` stub explaining why. `0` disables the gate. |
| `--transcribe-queue-max N` | idle | positive number | Warn (once, debounced) when the transcription queue depth exceeds N. Default `5`. Capture is never blocked; the warning just tells you transcription is falling behind. `0` disables the warning. |
| `--json` | transcribe | flag | Emit a JSON payload (`{ text, model, wav, durationMs, binary, txtPath, version, versionLabel }`) instead of plain text. |

### Per-chunk artifacts

In `idle` mode each chunk produces:

| File | Always | Description |
|---|---|---|
| `<basename>.wav` | yes | The captured audio (16 kHz mono 16-bit signed PCM). |
| `<basename>.json` | yes | Sidecar metadata (schema v1): `{ version, wav, start, end, durationMs, audio, peak, peakDb, bytes }`. Empty placeholder chunks (sox waiting for audio that never arrived) are auto-deleted along with their sidecar slot. |
| `<basename>.txt` | with `--transcribe`, when the chunk is loud enough to transcribe | Verbatim whisper.cpp transcript. Empty file if whisper.cpp returned no speech but the chunk passed the peak gate. Absent entirely for chunks the peak gate skipped (see `<basename>.md`). |
| `<basename>.md` | with `--transcribe`, every chunk | Human-reviewable: H1 heading with timestamp, metadata block, links to the sibling files, transcript section. The `.md` is the single artifact a user opens per chunk -- it always lands, whether transcription succeeded, failed, or was skipped by the peak gate. Failure reason and skip reason both appear inline in the transcript section as italicised stubs. |
| `transcript.html` (per session, not per chunk) | with `--transcribe` | Single self-contained HTML document at the session-dir root that grows live as chunks complete. Open it in any browser; it's the meeting-level artifact. Each chunk gets a section with the HH:MM:SS, duration/peak/bytes summary, and the transcript text. Skipped + failed chunks also appear with explicit stubs so there's never a silent gap. |

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
chunk gets a `<basename>.txt` transcript and a human-reviewable
`<basename>.md` written next to its `.wav` and `.json` the moment
whisper.cpp finishes (typically within a few seconds of rotation on CPU).
Transcriptions run serially through an in-memory queue, so two long chunks
in a row will queue rather than fight for CPU. On `Ctrl+C` or when
`--duration` expires, the recorder waits for any queued transcripts to
finish before exiting -- you won't lose the tail of a meeting just because
you stopped capture early. If `--model <path>` is omitted, the default
`./models/ggml-base.en.bin` is used; missing-model paths fail fast before
capture starts.

By default chunks whose sidecar `peak` is below `0.005` (~−46 dBFS) are
**skipped**: they get a `.md` stub explaining the skip but no `.txt` and no
whisper.cpp CPU spent. This is the dead-air gate; tune via
`--transcribe-min-peak P` (set to `0` to transcribe every chunk regardless
of loudness). If transcription starts falling behind capture, a one-shot
`[transcribe backlog]` warning fires at queue depth `--transcribe-queue-max
5` (default); capture is never blocked, but you get an actionable signal
that something is wrong (CPU saturated, model too large, silence threshold
too low). A single retry is attempted on any non-zero whisper-cli exit,
which catches transient mapping races without masking persistent failures.

### Live demo — speak, watch transcripts appear

This is the canonical Phase 4 demo. It proves end-to-end that LocalRecorder
captures, chunks, and transcribes spoken audio without intervention. Total
time: ~60 seconds of wall clock; you do not need to install anything beyond
the prerequisites above.

```bash
node src/index.js idle --name t6-demo --transcribe \
  --threshold 0.5 --silence 2 --duration 60
```

While it runs:

1. **Speak two or three sentences** with ~3 s pauses between them. Each
   pause longer than `--silence 2` ends the current chunk and rotates the
   recorder to a fresh one.
2. **In another terminal**, watch the session directory fill up:
   ```bash
   ls recordings/t6-demo/
   ```
   You should see, per chunk, a `.wav` appear first, then within a few
   seconds a matching `.json`, then `.txt`, then `.md`. The `.md` is the
   user-facing artifact -- open one in any editor and you will see the
   heading, metadata block, file links, and the transcript.
3. **On `Ctrl+C` or when the duration expires**, the recorder waits for any
   queued transcripts to finish before exiting. You will see
   `[transcribed]` lines streaming as the queue drains.

Acceptance criteria (per `docs/sprint-plan.md`):

- Every captured WAV has a sidecar (`.json`) and a markdown (`.md`).
- Loud-enough chunks also have a `.txt`. Silent chunks have a `.md` stub
  explaining the skip.
- No `sox` or `whisper-cli` processes are left running after Ctrl+C.

If transcription accuracy is disappointing on `ggml-base.en.bin` (the
default), step up to a bigger model -- see the table below.

### GPU acceleration

whisper.cpp can run on an NVIDIA GPU if the binary you have on PATH was built with CUDA (cuBLAS). The CPU baseline above is unchanged; GPU support is purely additive and falls back transparently when unavailable.

Quick check:

```bash
npm run gpu:check
```

That probe reports two independent things:

1. Whether `nvidia-smi` finds a GPU (with name, VRAM, driver version).
2. Whether the `whisper-cli` on PATH advertises GPU flags in its `--help` text (`--no-gpu`, `-ngl`, `cublas`, ...). A "yes" here strongly suggests but does not guarantee a cuBLAS build; the real proof shows up in GPU-5's benchmark and in whisper.cpp's own startup log line (`ggml_cuda_init: found N CUDA device(s)` on success, nothing on a CPU-only build).

If both halves are positive, GPU acceleration is available. Pass `--no-gpu` on `record`, `idle`, or `transcribe` to force CPU, or `--gpu-layers N` to control how many transformer layers are offloaded (whisper.cpp's `-ngl <N>`; default on a CUDA build is "all layers").

What gets recorded:

- The `transcribe --json` output gains `{ gpu, gpuLayers }` fields.
- Each chunk's sidecar `.json` gains a `transcribe: { model, language, gpu, gpuLayers }` block (schema v2).
- The per-chunk `.md` gains an `**Accelerator:** GPU (N layers)` or `**Accelerator:** CPU (forced)` line in the metadata block when GPU intent is set.
- The persistent `whisper-server` logs `[whisper-server] ready (GPU)` / `(CPU)` / `(default)` at startup.

Default (no flags) is unchanged: whisper.cpp's own build default decides, and the chunk artifacts look identical to v0.3.0.

To install a CUDA-enabled whisper.cpp build on Windows (one shot):

```bash
npm run gpu:install
```

That:

1. Calls the GitHub API for `ggerganov/whisper.cpp`'s latest release.
2. Picks the highest-CUDA-version `whisper-cublas-*-bin-x64.zip` asset (e.g. `whisper-cublas-12.4.0-bin-x64.zip`; ~450 MB).
3. Downloads it into `vendor/whisper-cuda/`, verifies SHA256 if the release publishes a digest, and extracts.
4. Records the release tag in `vendor/whisper-cuda/.installed.json` so re-running is a no-op until the upstream version changes.

Binary discovery in this project prefers `vendor/whisper-cuda/whisper-cli.exe` and `vendor/whisper-cuda/whisper-server.exe` over PATH, so once the installer finishes the next `npm start` / `npm run ui` automatically uses the cuBLAS build. No PATH edits, no shell restart.

`vendor/` is gitignored. The installer is Windows-only because whisper.cpp publishes prebuilt cuBLAS ZIPs only for Windows x64; on macOS / Linux, build whisper.cpp from source with CUDA support and either put it on PATH or copy into `vendor/whisper-cuda/` manually.

Manual install fallback (if you want to pin a specific CUDA toolkit version): grab the ZIP from <https://github.com/ggerganov/whisper.cpp/releases> and extract into `vendor/whisper-cuda/`.

To *prove* the GPU is actually being used:

```bash
npm run gpu:bench
```

That runs the same synthetic 10-second WAV through `whisper-cli` twice for each model under `models/*.bin` (once with `--no-gpu`, once with the binary's default), reports wall-clock mean/median and a CPU/GPU speedup ratio, and writes:

- `docs/gpu-bench-results.md` (committed, overwritten each run).
- `recordings/.bench/bench-<ts>.json` (gitignored, every per-sample timing for downstream analysis).

A speedup of ~1.0x means the binary on disk is CPU-only or the GPU isn't being driven — exactly what `gpu:install` is for. A speedup of 3-10x on `base.en` / `small.en` / `medium.en` is normal for a 4070-class GPU and is the green light to flip your live recordings onto a larger model.

Flags: `--runs N` (timed samples per side, default 3), `--duration S` (synthetic WAV length, default 10), `--threads N` (CPU threads passed to whisper.cpp), `--model PATH` (override auto-discovery, can repeat).

### Model trade-offs

`whisper.cpp` ships multiple ggml models. Bigger = better accuracy but
slower and more memory. The realtime ratios below are rough CPU estimates
for `whisper-cli`'s default settings on a typical modern laptop; your
mileage will vary, especially on integrated GPUs or older silicon. Linear
fit on the announced relative timings is "each step up roughly halves the
realtime ratio".

| Model | Size on disk | Typical CPU speed | Accuracy (English) | Recommended for |
|---|---|---|---|---|
| `ggml-tiny.en.bin` | ~75 MB | ~5–10x faster than realtime | Rough; misses unusual words | Quick keyword search, live captioning of a single clear speaker |
| `ggml-base.en.bin` | ~141 MB | ~2–4x faster than realtime | Decent for clear speech in a quiet room | Default; solo dictation and meeting notes |
| `ggml-small.en.bin` | ~466 MB | ~realtime to 1.5x | Good; handles light accents and multi-speaker | Routine meetings with 2–5 people |
| `ggml-medium.en.bin` | ~1.5 GB | ~0.5x realtime | Very good; handles accents and jargon | Important meetings, technical content |
| `ggml-large-v3.bin` | ~3.0 GB | ~0.2–0.3x realtime | Best available locally | Production transcription where accuracy matters more than turnaround |

Switch models per session with `--model models/ggml-medium.en.bin`. Mind
the disk / memory cost: medium and large are big enough to noticeably
impact a small laptop SSD if you keep multiple copies around.

## Development

Follow MDM (Markdown-Driven Development) workflow with incremental sprints. Each sprint ends with commit, validation, and documentation update.