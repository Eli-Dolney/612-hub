"""Local hook finder + silence islands. No cloud — transcript + ffmpeg only."""

from __future__ import annotations

import re
import subprocess
from typing import Any, Optional

from server.engine.ffmpeg import which_ffmpeg
from server.engine.transcript import kept_segments

HOOK_WORDS = frozenset(
    {
        "you",
        "your",
        "you're",
        "yours",
        "secret",
        "mistake",
        "never",
        "always",
        "stop",
        "why",
        "how",
        "what",
        "wait",
        "here's",
        "heres",
        "truth",
        "hack",
        "tip",
        "watch",
        "listen",
    }
)
NUMBER_RE = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b|\$\d|\b(?:one|two|three|four|five|ten|hundred|thousand|million)\b", re.I)


def _peak_energy(peaks: list[float], duration: float, start: float, end: float) -> float:
    if not peaks or duration <= 0:
        return 0.0
    n = len(peaks)
    a = max(0, min(n - 1, int((start / duration) * n)))
    b = max(a + 1, min(n, int((end / duration) * n) + 1))
    window = peaks[a:b]
    if not window:
        return 0.0
    return sum(float(p) for p in window) / len(window)


def _score_window(
    text: str,
    start: float,
    end: float,
    *,
    peaks: list[float],
    duration: float,
    word_count: int,
) -> float:
    span = max(0.1, end - start)
    score = 0.0
    lower = text.casefold()
    if "?" in text:
        score += 3.0
    if NUMBER_RE.search(text):
        score += 2.0
    tokens = re.findall(r"[a-z0-9']+", lower)
    hits = sum(1 for t in tokens if t in HOOK_WORDS)
    score += min(4.0, hits * 1.2)
    if start < 8.0:
        score += 1.5
    rate = word_count / span
    if rate >= 2.2:
        score += 2.0
    elif rate >= 1.4:
        score += 1.0
    energy = _peak_energy(peaks, duration, start, end)
    score += energy * 2.5
    # Prefer near-target length (handled by caller via window size)
    return round(score, 3)


def suggest_hooks(
    transcript: dict[str, Any],
    *,
    peaks: Optional[list[float]] = None,
    duration: float = 0.0,
    target_s: float = 30.0,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Score target-length windows from kept transcript lines."""
    segs = kept_segments(transcript)
    if not segs:
        return []
    peaks = list(peaks or [])
    duration = float(duration or (segs[-1]["end"] if segs else 0) or 0)
    target = max(12.0, min(60.0, float(target_s or 30)))
    # Sliding windows that cover contiguous kept speech
    candidates: list[dict[str, Any]] = []
    for i, seed in enumerate(segs):
        start = float(seed["start"])
        end = float(seed["end"])
        texts = [str(seed.get("text") or "").strip()]
        words = len(re.findall(r"\S+", texts[0]))
        j = i + 1
        while end - start < target and j < len(segs):
            nxt = segs[j]
            gap = float(nxt["start"]) - end
            if gap > 2.5:
                break
            end = float(nxt["end"])
            piece = str(nxt.get("text") or "").strip()
            if piece:
                texts.append(piece)
                words += len(re.findall(r"\S+", piece))
            j += 1
        if end - start < max(6.0, target * 0.35):
            # Pad toward target when speech is short but punchy
            end = min(duration or (start + target), start + target)
            if end - start < 6.0:
                continue
            texts = []
            words = 0
            for seg in segs:
                if float(seg["end"]) <= start or float(seg["start"]) >= end:
                    continue
                piece = str(seg.get("text") or "").strip()
                if piece:
                    texts.append(piece)
                    words += len(re.findall(r"\S+", piece))
            if not texts:
                continue
        # Trim overshoot: prefer ending near target
        if end - start > target + 8:
            end = start + target
            # rebuild text within window
            texts = []
            words = 0
            for seg in segs[i:j]:
                if float(seg["start"]) >= end:
                    break
                if float(seg["end"]) <= start:
                    continue
                piece = str(seg.get("text") or "").strip()
                if piece:
                    texts.append(piece)
                    words += len(re.findall(r"\S+", piece))
        text = " ".join(texts).strip()
        if not text:
            continue
        score = _score_window(
            text,
            start,
            end,
            peaks=peaks,
            duration=duration,
            word_count=max(1, words),
        )
        candidates.append(
            {
                "start": round(start, 3),
                "end": round(min(end, duration or end), 3),
                "duration": round(min(end, duration or end) - start, 3),
                "text": text[:240],
                "score": score,
                "kind": "talk",
            }
        )

    # Deduplicate heavily overlapping windows (keep higher score)
    candidates.sort(key=lambda c: (-c["score"], c["start"]))
    picked: list[dict[str, Any]] = []
    for row in candidates:
        if any(
            abs(row["start"] - p["start"]) < target * 0.35
            or (min(row["end"], p["end"]) - max(row["start"], p["start"])) > target * 0.55
            for p in picked
        ):
            continue
        picked.append(row)
        if len(picked) >= top_n:
            break

    for i, row in enumerate(picked, start=1):
        row["label"] = f"Hook {i}"
    return picked


def silence_islands_from_transcript(
    transcript: dict[str, Any],
    *,
    settings: Optional[dict[str, Any]] = None,
    duration: float = 0.0,
) -> list[dict[str, Any]]:
    """Speech islands from kept word/segment gaps (no ffmpeg)."""
    cfg = settings or {}
    split_pause = float(cfg.get("split_pause_s") or 0.8)
    padding = float(cfg.get("padding_s") or 0.08)
    merge_gap = float(cfg.get("merge_gap_s") or 0.25)
    segs = kept_segments(transcript)
    if not segs:
        return []

    islands: list[dict[str, Any]] = []
    start = float(segs[0]["start"])
    end = float(segs[0]["end"])
    texts = [str(segs[0].get("text") or "").strip()]
    for seg in segs[1:]:
        gap = float(seg["start"]) - end
        if gap > split_pause:
            islands.append(_island(start, end, texts, padding, duration))
            start = float(seg["start"])
            end = float(seg["end"])
            texts = [str(seg.get("text") or "").strip()]
        else:
            end = float(seg["end"])
            piece = str(seg.get("text") or "").strip()
            if piece:
                texts.append(piece)
    islands.append(_island(start, end, texts, padding, duration))

    merged: list[dict[str, Any]] = []
    for item in islands:
        if not item:
            continue
        if merged and item["start"] - merged[-1]["end"] <= merge_gap:
            prev = merged[-1]
            prev["end"] = item["end"]
            prev["duration"] = round(prev["end"] - prev["start"], 3)
            prev["text"] = (prev["text"] + " " + item["text"]).strip()[:240]
        else:
            merged.append(item)

    for i, row in enumerate(merged, start=1):
        row["label"] = f"Speech {i}"
        row["kind"] = "talk"
        row["score"] = 0.0
    return [r for r in merged if r["duration"] >= 0.35]


def silence_islands_from_audio(
    audio: Any,
    *,
    duration: float = 0.0,
    settings: Optional[dict[str, Any]] = None,
    noise_db: float = -35.0,
) -> list[dict[str, Any]]:
    """FFmpeg silencedetect → speech islands between silence spans."""
    from pathlib import Path

    path = Path(audio)
    if not path.is_file():
        return []
    cfg = settings or {}
    split_pause = float(cfg.get("split_pause_s") or 0.8)
    padding = float(cfg.get("padding_s") or 0.08)
    merge_gap = float(cfg.get("merge_gap_s") or 0.25)
    min_silence = max(0.25, split_pause * 0.75)

    result = subprocess.run(
        [
            which_ffmpeg(),
            "-hide_banner",
            "-i",
            str(path),
            "-af",
            f"silencedetect=noise={noise_db}dB:d={min_silence}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    log = (result.stderr or "") + (result.stdout or "")
    starts = [float(m.group(1)) for m in re.finditer(r"silence_start:\s*([\d.]+)", log)]
    ends = [float(m.group(1)) for m in re.finditer(r"silence_end:\s*([\d.]+)", log)]
    # Pair silence intervals
    silences: list[tuple[float, float]] = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else (duration or s + min_silence)
        silences.append((s, e))

    if duration <= 0:
        duration = ends[-1] if ends else (starts[-1] + 1.0 if starts else 0.0)

    # Invert silences → speech
    cursor = 0.0
    raw: list[tuple[float, float]] = []
    for s, e in silences:
        if s > cursor + 0.05:
            raw.append((cursor, s))
        cursor = max(cursor, e)
    if duration and duration > cursor + 0.05:
        raw.append((cursor, duration))
    if not silences and duration > 0.35:
        raw = [(0.0, duration)]

    islands: list[dict[str, Any]] = []
    for a, b in raw:
        start = max(0.0, a - padding)
        end = min(duration or b + padding, b + padding)
        if end - start < 0.35:
            continue
        islands.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(end - start, 3),
                "text": "",
                "kind": "talk",
                "score": 0.0,
            }
        )

    merged: list[dict[str, Any]] = []
    for item in islands:
        if merged and item["start"] - merged[-1]["end"] <= merge_gap:
            prev = merged[-1]
            prev["end"] = item["end"]
            prev["duration"] = round(prev["end"] - prev["start"], 3)
        else:
            merged.append(item)
    for i, row in enumerate(merged, start=1):
        row["label"] = f"Speech {i}"
    return merged


def _island(
    start: float,
    end: float,
    texts: list[str],
    padding: float,
    duration: float,
) -> Optional[dict[str, Any]]:
    a = max(0.0, start - padding)
    b = end + padding
    if duration and duration > 0:
        b = min(b, duration)
    if b - a < 0.08:
        return None
    return {
        "start": round(a, 3),
        "end": round(b, 3),
        "duration": round(b - a, 3),
        "text": " ".join(t for t in texts if t).strip()[:240],
        "kind": "talk",
        "score": 0.0,
    }
