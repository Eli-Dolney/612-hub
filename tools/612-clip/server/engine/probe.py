"""Probe a video: duration, poster, waveform peaks. Whisper does not run here."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from server.engine.ffmpeg import grab_frame, probe, which_ffmpeg

ProgressFn = Callable[[float, str], None]


def waveform_peaks(path: Path, duration: float, buckets: int = 720) -> list[float]:
    if duration <= 0:
        return [0.0] * buckets
    sr = 2000
    cmd = [
        which_ffmpeg(),
        "-v",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sr),
        "-f",
        "f32le",
        "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None
    total = max(1.0, duration * sr)
    hop = max(1, int(total / buckets))
    peaks = [0.0] * buckets
    bucket = 0
    filled = 0
    current = 0.0
    try:
        while bucket < buckets:
            raw = proc.stdout.read(8192)
            if not raw:
                break
            samples = np.frombuffer(raw, dtype=np.float32)
            for sample in samples:
                current = max(current, abs(float(sample)))
                filled += 1
                if filled >= hop:
                    peaks[bucket] = current
                    bucket += 1
                    filled = 0
                    current = 0.0
                    if bucket >= buckets:
                        break
    finally:
        proc.kill()
    peak = max(peaks) or 1.0
    return [round(p / peak, 4) for p in peaks]


def run_probe(src: Path, dest_dir: Path, progress: ProgressFn | None = None) -> dict:
    if progress:
        progress(0.05, "Reading streams")
    info = probe(src)
    if not info["has_video"]:
        raise RuntimeError("This file has no video stream")
    if progress:
        progress(0.2, "Poster frame")
    poster_at = info["duration"] * 0.12 if info["duration"] else 0.0
    poster = dest_dir / "poster.jpg"
    try:
        grab_frame(src, poster, poster_at)
    except Exception:
        grab_frame(src, poster, 0.0)
    peaks: list[float] = []
    if info["has_audio"]:
        if progress:
            progress(0.45, "Waveform")
        peaks = waveform_peaks(src, info["duration"])
    else:
        peaks = [0.08] * 720
    if progress:
        progress(1.0, "Probed")
    return {**info, "poster_at": poster_at, "peaks": peaks}
