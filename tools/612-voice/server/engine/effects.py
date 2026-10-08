from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


def apply_effects(
    wav: np.ndarray,
    sr: int,
    *,
    gain_db: float = 0.0,
    pitch_semitones: float = 0.0,
    highpass_hz: float = 0.0,
    lowpass_hz: float = 0.0,
    reverb: float = 0.0,
) -> np.ndarray:
    out = np.asarray(wav, dtype=np.float32).squeeze()
    if pitch_semitones:
        import librosa

        out = librosa.effects.pitch_shift(out, sr=sr, n_steps=float(pitch_semitones)).astype(np.float32)
    if highpass_hz or lowpass_hz:
        from scipy.signal import butter, sosfilt

        ny = 0.5 * sr
        if highpass_hz and highpass_hz < ny:
            sos = butter(2, highpass_hz / ny, btype="highpass", output="sos")
            out = sosfilt(sos, out).astype(np.float32)
        if lowpass_hz and 0 < lowpass_hz < ny:
            sos = butter(2, lowpass_hz / ny, btype="lowpass", output="sos")
            out = sosfilt(sos, out).astype(np.float32)
    if reverb > 0:
        mix = min(0.7, max(0.0, float(reverb)))
        delay = int(sr * 0.045)
        decay = np.exp(-np.linspace(0, 3.2, delay * 6)).astype(np.float32)
        wet = np.convolve(out, decay, mode="full")[: out.size]
        out = ((1.0 - mix) * out + mix * wet).astype(np.float32)
    if gain_db:
        out = (out * (10 ** (gain_db / 20.0))).astype(np.float32)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 1.0:
        out = (out / peak * 0.98).astype(np.float32)
    return out


def process_file(src: Path, dst: Path, **kwargs) -> Path:
    wav, sr = sf.read(str(src), always_2d=False)
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    out = apply_effects(wav, sr, **kwargs)
    dst.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(dst), out, sr)
    return dst
