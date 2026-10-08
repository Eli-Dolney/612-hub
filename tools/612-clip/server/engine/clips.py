"""Manual keep ranges — a select-bin, not an NLE."""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

MIN_CLIP = 0.05


def _swap(start: float, end: float) -> tuple[float, float]:
    if end < start:
        return end, start
    return start, end


def normalize_clip(
    raw: dict[str, Any],
    *,
    duration: float = 0.0,
    clip_id: int = 1,
) -> dict[str, Any]:
    start, end = _swap(float(raw.get("start") or 0), float(raw.get("end") or 0))
    start = max(0.0, start)
    if duration and duration > 0:
        end = min(end, duration)
        start = min(start, max(0.0, duration - MIN_CLIP))
    if end - start < MIN_CLIP:
        raise ValueError("Clip must be at least 0.05 seconds")
    label = str(raw.get("label") or "").strip() or f"Clip {clip_id}"
    kind = str(raw.get("kind") or "talk").strip().lower()
    if kind not in ("talk", "broll", "intro"):
        kind = "talk"
    return {
        "id": int(raw.get("id") or clip_id),
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(end - start, 3),
        "label": label[:80],
        "kept": bool(raw.get("kept", True)),
        "text": str(raw.get("text") or label)[:240],
        "kind": kind,
    }


def load_clips(data: dict[str, Any], duration: float = 0.0) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(data.get("clips") or []):
        if not isinstance(raw, dict):
            continue
        try:
            cid = int(raw.get("id") or i + 1)
            out.append(normalize_clip(raw, duration=duration, clip_id=cid))
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda c: (c["start"], c["end"], c["id"]))
    return out


def next_clip_id(clips: Iterable[dict[str, Any]]) -> int:
    ids = [int(c["id"]) for c in clips if c.get("id") is not None]
    return (max(ids) if ids else 0) + 1


def kept_clips(clips: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [c for c in clips if c.get("kept", True)]


def clip_to_range(clip: dict[str, Any]) -> dict[str, Any]:
    return {
        "start": float(clip["start"]),
        "end": float(clip["end"]),
        "duration": float(clip.get("duration") or (float(clip["end"]) - float(clip["start"]))),
        "text": str(clip.get("text") or clip.get("label") or ""),
        "id": clip.get("id"),
        "label": str(clip.get("label") or ""),
    }


def clips_to_ranges(clips: Iterable[dict[str, Any]], *, kept_only: bool = True) -> list[dict[str, Any]]:
    rows = kept_clips(clips) if kept_only else list(clips)
    rows = sorted(rows, key=lambda c: (c["start"], c["end"], c["id"]))
    return [clip_to_range(c) for c in rows]


def clip_filename(clip: dict[str, Any]) -> str:
    stem = re.sub(r"[^\w]+", "_", str(clip.get("label") or "clip")).strip("_")[:40] or "clip"
    return f"{int(clip.get('id') or 1):02d}_{stem}.mp4"


def find_clip(clips: Iterable[dict[str, Any]], clip_id: int) -> Optional[dict[str, Any]]:
    for clip in clips:
        if int(clip["id"]) == int(clip_id):
            return clip
    return None
