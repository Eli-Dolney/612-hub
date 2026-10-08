from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class QCResult:
    passed: bool
    issues: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

    @property
    def summary(self) -> str:
        return "ok" if self.passed else "; ".join(self.issues)


def _duration_bounds(text: str) -> tuple[float, float]:
    chars = max(1, len(text.strip()))
    return max(0.4, chars / 22.0), max(1.0, chars / 6.0)


def check_clip(wav, sr: int, text: str) -> QCResult:
    import numpy as np

    issues: list[str] = []
    if wav is None or getattr(wav, "size", 0) == 0:
        return QCResult(False, ["empty audio"], 0.0)

    audio = np.asarray(wav, dtype=np.float64).squeeze()
    if audio.ndim != 1:
        audio = audio.reshape(-1)

    if not np.isfinite(audio).all():
        issues.append("contains NaN or Inf")

    duration = float(audio.shape[0]) / float(sr) if sr > 0 else 0.0
    if duration < 0.15:
        issues.append("too short")

    min_dur, max_dur = _duration_bounds(text)
    if duration < min_dur * 0.5:
        issues.append("truncated")
    elif duration > max_dur * 2.5:
        issues.append("runaway generation")

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak < 1e-4:
        issues.append("mostly silent")
    elif peak >= 0.99:
        issues.append("clipping")

    rms = float(np.sqrt(np.mean(audio**2))) if audio.size else 0.0
    if rms < 0.005 and peak >= 1e-4:
        issues.append("very quiet")

    if audio.size > sr and peak > 1e-4:
        threshold = max(0.01, peak * 0.02)
        silent = np.abs(audio) < threshold
        max_run = current = 0
        for flag in silent:
            if flag:
                current += 1
                max_run = max(max_run, current)
            else:
                current = 0
        if max_run / sr > 1.5:
            issues.append("long internal silence")

    return QCResult(len(issues) == 0, issues, duration)
