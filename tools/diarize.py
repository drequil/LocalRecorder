"""
Offline speaker diarization using pyannote.audio's speaker-diarization-3.1 pipeline.

Usage: python tools/diarize.py <wav_file> [options]

Cross-chunk identity strategy
-----------------------------
pyannote outputs per-run labels (SPEAKER_00, SPEAKER_01, ...) that are NOT
stable across runs. To preserve the "Speaker 1" / "Speaker 2" identity across
recording chunks (the same feature the resemblyzer-backed predecessor offered),
we use the per-speaker centroid embeddings that the pipeline already returns
in `DiarizeOutput.speaker_embeddings`. Each centroid is matched against the
centroids saved from previous chunks (cosine similarity, threshold ~0.5) and
assigned the corresponding stable "Speaker N" label, otherwise a new label is
minted. The session JSON file therefore stores `{"Speaker N": [<float>, ...]}`,
the same shape as the resemblyzer version, and is updated in place using a
running-average to slowly track per-speaker drift.

Audio loading
-------------
This Windows host has pyannote.audio 4.0.4 with torchcodec installed, but
torchcodec's native libs cannot be loaded without FFmpeg. To avoid the
dependency we read the WAV with soundfile and hand the pipeline an
in-memory `{"waveform": (channel, time) torch.Tensor, "sample_rate": int}`
dict, which pyannote supports natively (see pyannote/audio/core/io.py).

Output contract (preserved from the resemblyzer version)
--------------------------------------------------------
- positional `wav` argument
- optional `--session-embeddings <path.json>`
- `--min-speakers <int>` (default 1)
- `--max-speakers <int>` (default 8)
- stdout: JSON array of `{"start": float, "end": float, "speaker": "Speaker N"}`
- on error: `{"error": "..."}` to stdout, exit 1
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import warnings
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

# pyannote.audio (and its deps) emit a flurry of UserWarnings on import and
# during inference. We silence them so they don't pollute the stderr that the
# Node.js parent captures for error logging.
warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

TARGET_SR = 16000
SIM_THRESHOLD = 0.5  # cosine similarity threshold for cross-chunk speaker re-id
EMA_ALPHA = 0.3      # weight for new centroid when updating existing one


def load_hf_token() -> str | None:
    repo_root = Path(__file__).resolve().parent.parent
    token_file = repo_root / ".hftoken"
    if token_file.exists():
        token = token_file.read_text(encoding="utf-8").strip()
        if token:
            return token
    return os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")


def load_wav_as_dict(path: str):
    """Read a WAV with soundfile and return a pyannote-compatible dict.

    Returns {"waveform": (1, time) torch.Tensor, "sample_rate": int}.
    """
    import soundfile as sf
    import torch

    audio, sr = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim == 2:
        # downmix to mono so we keep a single channel for diarization
        audio = audio.mean(axis=1)
    waveform = torch.from_numpy(audio).unsqueeze(0).contiguous()
    return {"waveform": waveform, "sample_rate": int(sr)}


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def load_session(path: str) -> Dict[str, np.ndarray]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return {k: np.array(v, dtype=np.float32) for k, v in raw.items()}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_session(path: str, centroids: Dict[str, np.ndarray]) -> None:
    serializable = {k: v.astype(np.float32).tolist() for k, v in centroids.items()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(serializable, f)


def assign_stable_labels(
    pyannote_labels: List[str],
    pyannote_centroids: np.ndarray,
    existing_centroids: Dict[str, np.ndarray],
    sim_threshold: float = SIM_THRESHOLD,
) -> Dict[str, str]:
    """Map pyannote per-run labels (SPEAKER_NN) to stable "Speaker N" labels.

    For each pyannote cluster we pick the best-matching existing centroid by
    cosine similarity. If similarity meets `sim_threshold` and that stable
    label hasn't already been claimed by a different pyannote cluster in this
    chunk, we re-use the label and slowly EMA-update its centroid. Otherwise
    we mint a fresh "Speaker N" with the next available number.

    Mutates `existing_centroids` in place. Returns the mapping
    `{pyannote_label: stable_label}`.
    """
    mapping: Dict[str, str] = {}
    used_stable: set[str] = set()

    def _next_num() -> int:
        n = len(existing_centroids) + 1
        used_nums = {
            int(lbl.split()[-1])
            for lbl in existing_centroids
            if lbl.startswith("Speaker ") and lbl.split()[-1].isdigit()
        }
        while n in used_nums:
            n += 1
        return n

    # Match in order so that earliest-seen pyannote labels (SPEAKER_00,
    # SPEAKER_01, ...) preferentially claim the lowest-numbered stable labels.
    for label, emb in zip(pyannote_labels, pyannote_centroids):
        if emb is None or not np.any(emb):
            # Empty / zero centroid: still need a stable label, just create one.
            stable = f"Speaker {_next_num()}"
            existing_centroids[stable] = np.asarray(emb, dtype=np.float32)
            used_stable.add(stable)
            mapping[label] = stable
            continue

        best_label: str | None = None
        best_sim = -1.0
        for stable_label, centroid in existing_centroids.items():
            if stable_label in used_stable:
                continue
            sim = cosine_similarity(emb, centroid)
            if sim > best_sim:
                best_sim = sim
                best_label = stable_label

        if best_label is not None and best_sim >= sim_threshold:
            stable = best_label
            existing_centroids[stable] = (
                (1.0 - EMA_ALPHA) * existing_centroids[stable]
                + EMA_ALPHA * np.asarray(emb, dtype=np.float32)
            ).astype(np.float32)
        else:
            stable = f"Speaker {_next_num()}"
            existing_centroids[stable] = np.asarray(emb, dtype=np.float32)

        used_stable.add(stable)
        mapping[label] = stable

    return mapping


def annotation_to_segments(
    annotation, label_map: Dict[str, str]
) -> List[Tuple[float, float, str]]:
    raw = []
    for segment, _, label in annotation.itertracks(yield_label=True):
        stable = label_map.get(label, label)
        raw.append((float(segment.start), float(segment.end), stable))
    return raw


def merge_segments(assignments: List[Tuple[float, float, str]]) -> List[dict]:
    if not assignments:
        return []
    # pyannote returns turns roughly in time order, but normalise just in case
    assignments = sorted(assignments, key=lambda x: x[0])
    merged: List[dict] = []
    cur_start, cur_end, cur_label = assignments[0]
    for start, end, label in assignments[1:]:
        if label == cur_label and start <= cur_end + 0.05:
            cur_end = max(cur_end, end)
        else:
            merged.append(
                {"start": round(cur_start, 3), "end": round(cur_end, 3), "speaker": cur_label}
            )
            cur_start, cur_end, cur_label = start, end, label
    merged.append(
        {"start": round(cur_start, 3), "end": round(cur_end, 3), "speaker": cur_label}
    )
    return merged


# Cache the pipeline at module level so that repeated invocations within a
# single Python process (e.g. tests, future batch tools) do not pay the
# load cost more than once. The Node.js side spawns a fresh process per
# chunk today, so this is mostly a developer-experience nicety.
_PIPELINE = None


def get_pipeline():
    global _PIPELINE
    if _PIPELINE is not None:
        return _PIPELINE

    from pyannote.audio import Pipeline

    token = load_hf_token()
    if not token:
        raise RuntimeError(
            "Hugging Face token not found. Place it in <repo>/.hftoken or set "
            "HUGGINGFACE_TOKEN / HF_TOKEN."
        )

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=token,
    )
    if pipeline is None:
        raise RuntimeError(
            "Pipeline.from_pretrained returned None — check model access "
            "(accept the user agreement at "
            "https://huggingface.co/pyannote/speaker-diarization-3.1)."
        )

    _PIPELINE = pipeline
    return pipeline


def diarize_one(
    wav_path: str,
    min_speakers: int,
    max_speakers: int,
    session_path: str | None,
) -> List[dict]:
    pipeline = get_pipeline()

    audio_dict = load_wav_as_dict(wav_path)
    total_duration = float(audio_dict["waveform"].shape[-1]) / float(audio_dict["sample_rate"])

    result = pipeline(
        audio_dict,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
    )

    # pyannote 4.x returns DiarizeOutput; pyannote 3.x returns Annotation.
    if hasattr(result, "speaker_diarization"):
        annotation = result.speaker_diarization
        embeddings = getattr(result, "speaker_embeddings", None)
    else:
        annotation = result
        embeddings = None

    labels = list(annotation.labels())

    if not labels:
        return [{"start": 0.0, "end": round(total_duration, 3), "speaker": "Speaker 1"}]

    # Build the stable-label mapping. If we have no centroids (no session
    # tracking, or pyannote didn't return embeddings), just rename
    # SPEAKER_NN -> Speaker N+1 in the order the labels appear.
    if session_path and embeddings is not None and len(embeddings) >= len(labels):
        existing = load_session(session_path)
        mapping = assign_stable_labels(
            labels,
            np.asarray(embeddings, dtype=np.float32)[: len(labels)],
            existing,
            sim_threshold=SIM_THRESHOLD,
        )
        save_session(session_path, existing)
    else:
        mapping = {label: f"Speaker {i + 1}" for i, label in enumerate(labels)}

    raw = annotation_to_segments(annotation, mapping)
    return merge_segments(raw)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Offline speaker diarization via pyannote.audio speaker-diarization-3.1"
    )
    parser.add_argument("wav", help="Input WAV file")
    parser.add_argument(
        "--session-embeddings",
        metavar="PATH",
        help="JSON file for cross-chunk speaker identity",
    )
    parser.add_argument("--min-speakers", type=int, default=1, metavar="N")
    parser.add_argument("--max-speakers", type=int, default=8, metavar="N")
    args = parser.parse_args()

    # Force UTF-8 stdout so JSON with non-ASCII doesn't get mangled by cp1252
    # on Windows. Wrap once, idempotently.
    if hasattr(sys.stdout, "buffer") and not isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    try:
        segments = diarize_one(
            args.wav,
            min_speakers=args.min_speakers,
            max_speakers=args.max_speakers,
            session_path=args.session_embeddings,
        )
        print(json.dumps(segments, indent=2))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
