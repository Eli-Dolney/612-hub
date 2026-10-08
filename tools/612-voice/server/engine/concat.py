from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


def read_mono(path: Path, target_sr: int) -> np.ndarray:
    data, sr = sf.read(str(path), always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = np.nan_to_num(data.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    if sr != target_sr:
        import librosa

        data = librosa.resample(data, orig_sr=sr, target_sr=target_sr).astype(np.float32)
    return data


def lufs_normalize(wave: np.ndarray, sr: int, target_lufs: float) -> np.ndarray:
    try:
        import pyloudnorm as pyln
    except Exception:
        return wave
    meter = pyln.Meter(sr)
    mono = wave.mean(axis=1) if wave.ndim > 1 else wave
    loud = meter.integrated_loudness(mono)
    if not np.isfinite(loud):
        return wave
    factor = 10 ** ((target_lufs - loud) / 20.0)
    return (wave * factor).astype(np.float32)


def concat_paths(
    files: list[Path],
    out_path: Path,
    *,
    gap_seconds: float = 0.35,
    target_sr: int = 48000,
    lufs_target: float | None = -16.0,
    crossfade_ms: float = 0.0,
) -> Path:
    if not files:
        raise ValueError("Nothing to concat")

    parts: list[np.ndarray] = []
    fade = int(target_sr * max(0.0, crossfade_ms) / 1000.0)
    gap = np.zeros(int(target_sr * max(0.0, gap_seconds)), dtype=np.float32)

    for idx, path in enumerate(files):
        wav = read_mono(path, target_sr)
        peak = float(np.max(np.abs(wav))) if wav.size else 0.0
        if peak > 1.0:
            wav = (wav / peak).astype(np.float32)
        if idx and fade > 0 and parts:
            prev = parts[-1]
            n = min(fade, prev.size, wav.size)
            if n > 0:
                ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
                prev[-n:] = prev[-n:] * (1.0 - ramp) + wav[:n] * ramp
                parts[-1] = prev
                wav = wav[n:]
            elif gap.size:
                parts.append(gap)
        elif idx and gap.size:
            parts.append(gap)
        parts.append(wav)

    combined = np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)
    peak = float(np.max(np.abs(combined))) if combined.size else 0.0
    if peak > 1.0:
        combined = (combined / peak).astype(np.float32)
    if lufs_target is not None:
        combined = lufs_normalize(combined, target_sr, lufs_target)
        peak = float(np.max(np.abs(combined))) if combined.size else 0.0
        if peak > 1.0:
            combined = (combined / peak).astype(np.float32)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), combined, target_sr)
    return out_path
