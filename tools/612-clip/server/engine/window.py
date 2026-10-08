"""In/out window on a source — cut 30s without rewriting the file."""

from __future__ import annotations

from typing import Any, Optional


def resolve_window(
    duration: float,
    *,
    mode: str = "keep",
    start: float = 0.0,
    seconds: float = 30.0,
) -> dict[str, float]:
    duration = max(0.0, float(duration or 0))
    seconds = max(0.1, float(seconds or 30))
    start = max(0.0, float(start or 0))
    if duration <= 0:
        if mode == "drop_head":
            return {"start": seconds, "end": seconds + 0.1}
        if mode == "drop_tail":
            return {"start": 0.0, "end": seconds}
        return {"start": start, "end": start + seconds}

    if mode == "drop_head":
        a = min(seconds, max(0.0, duration - 0.05))
        return {"start": round(a, 3), "end": round(duration, 3)}
    if mode == "drop_tail":
        b = max(0.05, duration - seconds)
        return {"start": 0.0, "end": round(b, 3)}
    a = min(start, max(0.0, duration - 0.05))
    b = min(duration, a + seconds)
    if b <= a:
        b = duration
    return {"start": round(a, 3), "end": round(b, 3)}


def as_range(window: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not window:
        return None
    start = float(window.get("start") or 0)
    end = float(window.get("end") or 0)
    if end - start < 0.05:
        return None
    return {"start": start, "end": end, "duration": round(end - start, 3), "text": ""}


def clip_ranges(
    ranges: list[dict[str, Any]],
    window: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    bounds = as_range(window)
    if not bounds:
        return ranges
    ws, we = bounds["start"], bounds["end"]
    out: list[dict[str, Any]] = []
    for rng in ranges:
        a = max(float(rng["start"]), ws)
        b = min(float(rng["end"]), we)
        if b - a < 0.05:
            continue
        out.append({**rng, "start": a, "end": b, "duration": round(b - a, 3)})
    return out
