# LocalRecorder — Quickstart

All commands assume your current directory is the repo root. By default,
output lands under `./recordings/<YYYY-MM-DD>/` (and `./recordings/<YYYY-MM-DD>/<name>/`
when you use `--name`). Override the root with **`--root`**, or set a machine default
with **`%USERPROFILE%\.localrecorder\config.json`** (JSON: `"recordingsRoot": "D:/recordings"`).
A positional path still wins and skips the auto-layout.

## Quick reference

| What you want | Command | Output |
|---|---|---|
| **See if the mic works** (no files written) | `node src/index.js listen` | nothing on disk — live peak meter only |
| **Quick test record** (one WAV, 5 s) | `node src/index.js record --duration 5` | `./recordings/2026-05-12/recording-<ts>.wav` — if `./models/ggml-base.en.bin` exists, **transcription still runs automatically** after stop; otherwise WAV + `.json` only |
| **Named single recording** | `node src/index.js record --name testcall --duration 30` | `./recordings/2026-05-12/testcall/testcall-<ts>.wav` |
| **Single WAV + transcribe after stop** | `node src/index.js record --name memo --transcribe --model models\ggml-base.en.bin --duration 120` | One `.wav` + sidecar under the date/name folder; on Ctrl+C or duration end, whisper runs once → `.txt`, `.md`, `transcript.html` there |
| **Chunked capture, no transcription** (5 minutes) | `node src/index.js idle --name meeting --duration 300` | `./recordings/2026-05-12/meeting/chunk-<ts>.wav` + `.json` per silence-rotated chunk |
| **Phase 4 demo: capture + auto-transcribe** | `node src/index.js idle --name demo --duration 60 --threshold 0.5 --silence 2 --transcribe` | `./recordings/2026-05-12/demo/chunk-<ts>.{wav,json,txt,md}` quartet per chunk |
| **Long meeting, leave it running** (1 hour) | `node src/index.js idle --name standup --duration 3600 --threshold 0.5 --silence 20 --transcribe` | `./recordings/2026-05-12/standup/` filling up live |
| **Push output OUT of the repo entirely** | `node src/index.js idle --root D:\recordings --name meeting --transcribe --duration 60` | `D:\recordings\2026-05-12\meeting\chunk-<ts>.{wav,json,txt,md}` |
| **Pick a specific output dir** (no auto-layout) | `node src/index.js idle "D:\meetings\client-call" --transcribe --duration 60` | `D:\meetings\client-call\chunk-<ts>.{wav,json,txt,md}` (verbatim) |
| **Higher-accuracy transcription** | `node src/index.js idle --name interview --transcribe --model models\ggml-small.en.bin --duration 600` | `./recordings/2026-05-12/interview/...` with `small.en` quality |
| **Transcribe one existing WAV** | `node src/index.js transcribe .\recordings\2026-05-12\meeting\chunk-20260512-162301-489.wav` | prints transcript to stdout; writes `<basename>.txt` next to the wav |
| **Same, as JSON** | `node src/index.js transcribe .\path\to.wav --json` | `{ text, model, wav, durationMs, ... }` on stdout |
| **Skip dead-air chunks** (default on; shows the knob) | `node src/index.js idle --name talk --transcribe --transcribe-min-peak 0.01 --duration 60` | Dead-air chunks get a `.md` stub; no `.txt`, no whisper CPU |
| **Transcribe every chunk regardless of loudness** | `node src/index.js idle --name talk --transcribe --transcribe-min-peak 0 --duration 60` | Gate disabled |
| **Tighter backlog warning** (warn if 2+ chunks pile up) | `node src/index.js idle --name talk --transcribe --transcribe-queue-max 2 --duration 60` | `[transcribe backlog]` warns at depth > 2 |

## Where things land — layout + overrides

| You pass… | Output dir |
|---|---|
| nothing (just `idle` / `record`) | `./recordings/<YYYY-MM-DD>/` for that day’s unnamed captures |
| `--name <label>` | `./recordings/<YYYY-MM-DD>/<label>/` (label auto-slugified) |
| `--root <dir> [--name <label>]` | `<dir>/<YYYY-MM-DD>/` or `<dir>/<YYYY-MM-DD>/<label>/` |
| JSON config `recordingsRoot` (no `--root`) | Same layout as above, but under that root instead of `./recordings` |
| `LOCALRECORDER_CONFIG` env | Path to a JSON file with `recordingsRoot` — checked **before** `%USERPROFILE%\.localrecorder\config.json` |
| positional `<dir>` to `idle` | `<dir>/` verbatim — bypasses the auto-layout entirely |
| positional `<file>` to `record` | `<file>` verbatim — bypasses the auto-layout entirely |

## The two flags worth memorizing

- `--name <label>` — adds a **`<label>/`** folder under **today’s date**, so
  different meetings on the same calendar day stay grouped. Timestamped
  filenames keep files collision-free.
- `--transcribe` — turns on the Phase 4 pipeline. On **idle**, adds `.txt` /
  `.md` / `transcript.html` per chunk. On **record**, one WAV is captured and
  transcription runs once when the file closes (same artifacts next to the
  WAV). Costs CPU; needs `whisper-cli` on `PATH` and a model (default
  `./models/ggml-base.en.bin`, or `--model <path>`).

## Verbose traces (debugging “no transcription”)

Set `LOCALRECORDER_TRACE=1` (or `true` / `yes` / `on`) **or** pass `--trace` on
`record` / `idle`. The CLI prints structured lines to **stderr** with prefix
`[lr:trace …]` showing: whether the transcription queue exists, WAV finalize
→ enqueue vs peak-gate skip, queue job start/end, whisper-cli spawn argv,
shutdown → `drainTranscriptions` boundaries.

Example (PowerShell):

```powershell
$env:LOCALRECORDER_TRACE = '1'
node src/index.js idle --name debug --transcribe --duration 15
```

Or in one line: `node src/index.js idle --name debug --transcribe --trace --duration 15`.

For each idle chunk you get up to four files:

| File | Always | Description |
|---|---|---|
| `<basename>.wav` | yes | The captured audio (16 kHz mono 16-bit signed PCM). |
| `<basename>.json` | yes | Sidecar metadata — `{ version, wav, start, end, durationMs, audio, peak, peakDb, bytes }`. |
| `<basename>.txt` | only when the chunk passes the peak gate | Verbatim whisper.cpp transcript. Empty file when whisper returned no speech. |
| `<basename>.md` | yes, every chunk | Per-chunk markdown: H1 with timestamp, metadata block, file links, transcript section. On failure or peak-gate skip the `.md` still lands with an italicised stub explaining why. |
| `transcript.html` | yes, one per session | **The meeting-level artifact.** A single self-contained HTML document at the session-dir root that grows live as chunks complete. Open it in any browser; you don't need any of the per-chunk files to read it. |

## `record` and automatic transcription

For **single-file** capture, you do **not** need a second `transcribe` command when the
default model file is present: if `models/ggml-base.en.bin` exists (or the path you pass
with `--model`), whisper.cpp runs **once** after you press Ctrl+C or when `--duration`
expires. The same shutdown path as `idle --transcribe` waits for that job to finish
before exit.

- **`--no-transcribe`** — force WAV + sidecar only (no whisper), even if the model exists.
- **`--transcribe`** — force transcription; errors at startup if the model path is missing.

**`idle`** does **not** auto-enable transcription when the model exists (every chunk would
spawn whisper without an explicit opt-in). Use `idle … --transcribe` there.

In some audio environments sox's silence detector misfires (room noise floor fluctuates around the threshold), rotating chunks every few seconds. Pass `--silence 0` to bypass it entirely; chunks then rotate **only** on `--max-chunk-seconds`. For a meeting you usually want 5-minute chunks:

```cmd
node D:\repos\LocalRecorder\src\index.js idle --root D:\recordings --name MeetingTest --transcribe --model D:\repos\LocalRecorder\models\ggml-base.en.bin --silence 0 --max-chunk-seconds 300
```

## Worked example — default `D:\recordings` without typing `--root`

Create **`%USERPROFILE%\.localrecorder\config.json`** (one-time):

```json
{ "recordingsRoot": "D:/recordings" }
```

Then from the repo (or anywhere, if you use full paths to `src\index.js` and
`--model`), captures use **`D:\recordings\<YYYY-MM-DD>\`** or
**`D:\recordings\<YYYY-MM-DD>\<name>\`**. **`--root` on the command line still wins**
over the file.

Example session with a time-based **name** (slug becomes the folder under today’s date):

```powershell
node src/index.js idle --name $(Get-Date -Format yyyyMMdd-HHmm) `
                      --threshold 0.5 --silence 5 --transcribe --duration 3600
```

That lands under `D:\recordings\2026-05-12\20260512-1700\` (date + name) as `chunk-*.wav` +
`.json` + `.txt` + `.md` — and the repo tree stays clean if you rely on the config root.

## When something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `sox: command not found` | `sox` not on PATH | Install Chocolatey package `sox`, or download a Windows build and add to `PATH` |
| `transcribe: no whisper.cpp CLI found on PATH` | `whisper-cli` not on PATH | `npm run transcribe:check` for guided install steps |
| `transcribe: model file not found` | Missing `./models/ggml-base.en.bin` | Download from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` to `./models/`, or pass `--model <path>` |
| All chunks getting `_Skipped: peak ... below ..._` | Mic gain too low / silent room | Either raise mic gain in OS, or set `--transcribe-min-peak 0` to disable the gate |
| `[transcribe backlog] queue depth ...` keeps firing | Capture is outrunning transcription | Raise `--silence` (longer pauses before rotating), or lower `--max-chunk-seconds`, or switch to a smaller model (`base.en` → `tiny.en`) |
| Recording works but no `.txt` / `transcript.html` | `record` without `--transcribe`, or idle with every chunk peak-gated | Use `record … --transcribe` or `idle … --transcribe --transcribe-min-peak 0`; run with `--trace` to see the decision log |
| Need to see why whisper never ran | Opaque failure | `LOCALRECORDER_TRACE=1` or `--trace`; check stderr for `[finalize]`, `[queue]`, `[whisper]` stages |

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
