# LocalRecorder — Quickstart

All commands assume your current directory is the repo root. Output always
lands under `./recordings/<session>/` unless you override it with `--root`
or a positional path, so nothing pollutes the repo root.

## Quick reference

| What you want | Command | Output |
|---|---|---|
| **See if the mic works** (no files written) | `node src/index.js listen` | nothing on disk — live peak meter only |
| **Quick test record** (one WAV, 5 s) | `node src/index.js record --duration 5` | `./recordings/2026-05-12/recording-<ts>.wav` |
| **Named single recording** | `node src/index.js record --name testcall --duration 30` | `./recordings/testcall/testcall-<ts>.wav` |
| **Chunked capture, no transcription** (5 minutes) | `node src/index.js idle --name meeting --duration 300` | `./recordings/meeting/chunk-<ts>.wav` + `.json` per silence-rotated chunk |
| **Phase 4 demo: capture + auto-transcribe** | `node src/index.js idle --name demo --duration 60 --threshold 0.5 --silence 2 --transcribe` | `./recordings/demo/chunk-<ts>.{wav,json,txt,md}` quartet per chunk |
| **Long meeting, leave it running** (1 hour) | `node src/index.js idle --name standup --duration 3600 --threshold 0.5 --silence 20 --transcribe` | `./recordings/standup/` filling up live |
| **Push output OUT of the repo entirely** | `node src/index.js idle --root D:\recordings --name meeting --transcribe --duration 60` | `D:\recordings\meeting\chunk-<ts>.{wav,json,txt,md}` |
| **Pick a specific output dir** (no auto-layout) | `node src/index.js idle "D:\meetings\client-call" --transcribe --duration 60` | `D:\meetings\client-call\chunk-<ts>.{wav,json,txt,md}` (verbatim) |
| **Higher-accuracy transcription** | `node src/index.js idle --name interview --transcribe --model models\ggml-small.en.bin --duration 600` | `./recordings/interview/...` with `small.en` quality |
| **Transcribe one existing WAV** | `node src/index.js transcribe .\recordings\meeting\chunk-20260512-162301-489.wav` | prints transcript to stdout; writes `<basename>.txt` next to the wav |
| **Same, as JSON** | `node src/index.js transcribe .\path\to.wav --json` | `{ text, model, wav, durationMs, ... }` on stdout |
| **Skip dead-air chunks** (default on; shows the knob) | `node src/index.js idle --name talk --transcribe --transcribe-min-peak 0.01 --duration 60` | Dead-air chunks get a `.md` stub; no `.txt`, no whisper CPU |
| **Transcribe every chunk regardless of loudness** | `node src/index.js idle --name talk --transcribe --transcribe-min-peak 0 --duration 60` | Gate disabled |
| **Tighter backlog warning** (warn if 2+ chunks pile up) | `node src/index.js idle --name talk --transcribe --transcribe-queue-max 2 --duration 60` | `[transcribe backlog]` warns at depth > 2 |

## Where things land — three layout modes

| You pass… | Output dir |
|---|---|
| nothing (just `idle` / `record`) | `./recordings/<YYYY-MM-DD>/` (today's date, single shared folder) |
| `--name <label>` | `./recordings/<label>/` (auto-slugified — spaces and punctuation become `-`) |
| `--root <dir> [--name <label>]` | `<dir>/<label-or-date>/` |
| positional `<dir>` to `idle` | `<dir>/` verbatim — bypasses the auto-layout entirely |
| positional `<file>` to `record` | `<file>` verbatim — bypasses the auto-layout entirely |

## The two flags worth memorizing

- `--name <label>` — gives the session a meaningful folder name. Same name
  on different days appends to the same folder; the timestamped filenames
  keep them collision-free.
- `--transcribe` — turns on the Phase 4 pipeline. Adds the `.txt` and
  `.md` siblings for every loud-enough chunk. Costs CPU; needs
  `whisper-cli` on `PATH` and a model under `./models/ggml-base.en.bin`
  (or wherever you point `--model`).

## Per-chunk artifacts (with `--transcribe`)

For each idle chunk you get up to four files:

| File | Always | Description |
|---|---|---|
| `<basename>.wav` | yes | The captured audio (16 kHz mono 16-bit signed PCM). |
| `<basename>.json` | yes | Sidecar metadata — `{ version, wav, start, end, durationMs, audio, peak, peakDb, bytes }`. |
| `<basename>.txt` | only when the chunk passes the peak gate | Verbatim whisper.cpp transcript. Empty file when whisper returned no speech. |
| `<basename>.md` | yes, every chunk | Per-chunk markdown: H1 with timestamp, metadata block, file links, transcript section. On failure or peak-gate skip the `.md` still lands with an italicised stub explaining why. |
| `transcript.html` | yes, one per session | **The meeting-level artifact.** A single self-contained HTML document at the session-dir root that grows live as chunks complete. Open it in any browser; you don't need any of the per-chunk files to read it. |

## Disable the silence detector (recommended for long meetings)

In some audio environments sox's silence detector misfires (room noise floor fluctuates around the threshold), rotating chunks every few seconds. Pass `--silence 0` to bypass it entirely; chunks then rotate **only** on `--max-chunk-seconds`. For a meeting you usually want 5-minute chunks:

```cmd
node D:\repos\LocalRecorder\src\index.js idle --root D:\recordings --name MeetingTest --transcribe --model D:\repos\LocalRecorder\models\ggml-base.en.bin --silence 0 --max-chunk-seconds 300
```

## Worked example — keep your repo tidy

Route all sessions to an external directory so nothing ever lands in the
repo working tree:

```powershell
# One-time: set an env var so you don't have to type --root every time.
$env:LR_ROOT = "D:\recordings"

# Now any session goes under D:\recordings\<name>\
node src/index.js idle --root $env:LR_ROOT --name $(Get-Date -Format yyyyMMdd-HHmm) `
                      --threshold 0.5 --silence 5 --transcribe --duration 3600
```

That session lands under `D:\recordings\20260512-1700\` as `chunk-*.wav` +
`.json` + `.txt` + `.md` — and `D:\repos\LocalRecorder` stays clean.

## When something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `sox: command not found` | `sox` not on PATH | Install Chocolatey package `sox`, or download a Windows build and add to `PATH` |
| `transcribe: no whisper.cpp CLI found on PATH` | `whisper-cli` not on PATH | `npm run transcribe:check` for guided install steps |
| `transcribe: model file not found` | Missing `./models/ggml-base.en.bin` | Download from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` to `./models/`, or pass `--model <path>` |
| All chunks getting `_Skipped: peak ... below ..._` | Mic gain too low / silent room | Either raise mic gain in OS, or set `--transcribe-min-peak 0` to disable the gate |
| `[transcribe backlog] queue depth ...` keeps firing | Capture is outrunning transcription | Raise `--silence` (longer pauses before rotating), or lower `--max-chunk-seconds`, or switch to a smaller model (`base.en` → `tiny.en`) |
| Transcripts look like gibberish | Wrong model for your accent / language | Try `--model models/ggml-small.en.bin` or `ggml-medium.en.bin`; English models will not work for other languages — drop the `.en` for the multilingual variants |

## Model trade-offs (when `base.en` isn't enough)

| Model | Size on disk | Typical CPU speed | Accuracy (English) | Recommended for |
|---|---|---|---|---|
| `ggml-tiny.en.bin` | ~75 MB | ~5–10× faster than realtime | Rough; misses unusual words | Quick keyword search, live captioning of a single clear speaker |
| `ggml-base.en.bin` | ~141 MB | ~2–4× faster than realtime | Decent for clear speech in a quiet room | **Default**; solo dictation, meeting notes |
| `ggml-small.en.bin` | ~466 MB | ~realtime to 1.5× | Good; handles light accents and multi-speaker | Routine meetings with 2–5 people |
| `ggml-medium.en.bin` | ~1.5 GB | ~0.5× realtime | Very good; handles accents and jargon | Important meetings, technical content |
| `ggml-large-v3.bin` | ~3.0 GB | ~0.2–0.3× realtime | Best available locally | Production transcription where accuracy matters more than turnaround |

Switch models per session with `--model models/ggml-medium.en.bin`. Mind
the disk / memory cost: medium and large are big enough to noticeably
impact a small laptop SSD if you keep multiple copies around.
