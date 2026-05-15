"""
Offline speaker diarization using resemblyzer.
Usage: python tools/diarize.py <wav_file> [options]
"""
import argparse
import json
import sys
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd

TARGET_SR = 16000


def load_wav_mono_16k(path: str) -> np.ndarray:
    audio, sr = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR:
        g = gcd(sr, TARGET_SR)
        audio = resample_poly(audio, TARGET_SR // g, sr // g)
    return audio.astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def embed_windows(encoder, audio: np.ndarray, sr: int, window_sec: float, step_sec: float):
    window_samples = int(window_sec * sr)
    step_samples = int(step_sec * sr)
    n = len(audio)

    if n < window_samples:
        return [], []

    centers = []
    slices = []
    start = 0
    while start + window_samples <= n:
        slices.append(audio[start : start + window_samples])
        centers.append(start / sr)
        start += step_samples

    total_duration = n / sr
    times = []
    for i, c in enumerate(centers):
        seg_start = c
        seg_end = centers[i + 1] if i + 1 < len(centers) else total_duration
        times.append((seg_start, seg_end))

    embeddings = [encoder.embed_utterance(s) for s in slices]
    return embeddings, times


def assign_speakers(
    embeddings,
    times,
    existing_centroids: dict,
    sim_threshold: float = 0.82,
):
    """
    existing_centroids: {label: np.ndarray} – mutable, updated in place.
    Returns list of (start, end, label) tuples and updates existing_centroids.
    """
    # Track which window embeddings belong to each speaker for centroid recompute
    speaker_windows: dict = {lbl: [] for lbl in existing_centroids}
    assignments = []

    next_num = len(existing_centroids) + 1

    for emb, (start, end) in zip(embeddings, times):
        best_label = None
        best_sim = -1.0
        for label, centroid in existing_centroids.items():
            sim = cosine_similarity(emb, centroid)
            if sim > best_sim:
                best_sim = sim
                best_label = label

        if best_label is not None and best_sim >= sim_threshold:
            label = best_label
        else:
            label = f"Speaker {next_num}"
            next_num += 1
            existing_centroids[label] = emb.copy()
            speaker_windows[label] = []

        speaker_windows[label].append(emb)
        assignments.append((start, end, label))

    # Re-compute centroids as mean of all assigned windows
    for label, windows in speaker_windows.items():
        if windows:
            existing_centroids[label] = np.mean(windows, axis=0)

    return assignments


def merge_segments(assignments):
    if not assignments:
        return []
    segments = []
    cur_start, cur_end, cur_label = assignments[0]
    for start, end, label in assignments[1:]:
        if label == cur_label:
            cur_end = end
        else:
            segments.append({"start": round(cur_start, 3), "end": round(cur_end, 3), "speaker": cur_label})
            cur_start, cur_end, cur_label = start, end, label
    segments.append({"start": round(cur_start, 3), "end": round(cur_end, 3), "speaker": cur_label})
    return segments


def load_session(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return {k: np.array(v, dtype=np.float32) for k, v in raw.items()}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_session(path: str, centroids: dict):
    serializable = {k: v.tolist() for k, v in centroids.items()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(serializable, f)


def main():
    parser = argparse.ArgumentParser(description="Offline speaker diarization via resemblyzer")
    parser.add_argument("wav", help="Input WAV file")
    parser.add_argument("--session-embeddings", metavar="PATH", help="JSON file for cross-chunk speaker identity")
    parser.add_argument("--min-speakers", type=int, default=1, metavar="N")
    parser.add_argument("--max-speakers", type=int, default=8, metavar="N")
    parser.add_argument("--window-sec", type=float, default=1.5, metavar="SEC")
    parser.add_argument("--step-sec", type=float, default=0.75, metavar="SEC")
    args = parser.parse_args()

    try:
        from resemblyzer import VoiceEncoder, preprocess_wav

        audio_raw = load_wav_mono_16k(args.wav)
        total_duration = len(audio_raw) / TARGET_SR

        audio = preprocess_wav(audio_raw, source_sr=TARGET_SR)

        encoder = VoiceEncoder(verbose=False)

        embeddings, times = embed_windows(encoder, audio, TARGET_SR, args.window_sec, args.step_sec)

        if not embeddings:
            # Audio too short for even one window – single segment
            segments = [{"start": 0.0, "end": round(total_duration, 3), "speaker": "Speaker 1"}]
            print(json.dumps(segments, indent=2))
            return

        centroids = load_session(args.session_embeddings) if args.session_embeddings else {}

        assignments = assign_speakers(embeddings, times, centroids, sim_threshold=0.82)

        segments = merge_segments(assignments)

        if args.session_embeddings:
            save_session(args.session_embeddings, centroids)

        print(json.dumps(segments, indent=2))

    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
