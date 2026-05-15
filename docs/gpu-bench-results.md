# GPU benchmark results

Run at: 2026-05-15T17:15:48.163Z

## System

- Platform:   win32 x64
- Binary:     whisper-cli
- Build:      cuBLAS / CUDA-enabled
- GPU:        NVIDIA GeForce RTX 4070 Ti (12282 MiB)
- Driver:     560.94
- Sample:     3.0 s @ 16000 Hz mono PCM (synthetic, deterministic)

## Results

| Model | CPU mean (ms) | CPU RTF | GPU mean (ms) | GPU RTF | Speedup |
|---|---:|---:|---:|---:|---:|
| base.en | 2053 | 1.46x | 2012 | 1.49x | 1.02x |

## Notes

- **CPU run:** whisper-cli invoked with `--no-gpu` (force CPU).
- **GPU run:** whisper-cli invoked with no GPU flag (let the binary's build default decide).
- A speedup of ~1.0x means the binary is CPU-only or the GPU is not being used.
  Re-run `npm run gpu:check` to confirm the build is CUDA-enabled, or `npm run gpu:install`
  to fetch a cuBLAS build.
- Each row is `runs` timed samples + one warm-up. Mean is reported because variance on a
  busy machine can be high; the JSON dump under `recordings/.bench/` keeps every sample.
- Realtime factor (RTF) is `audio_seconds / wall_clock_seconds`. RTF > 1.0 means the
  transcription was faster than realtime (necessary for live-meeting transcription).
