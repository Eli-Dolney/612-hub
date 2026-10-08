"""Keep lines, drop fillers, tighten pauses. Transcript is the timeline."""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

FILLERS = frozenset(
    {
        "ah",
        "eh",
        "erm",
        "hmm",
        "huh",
        "like",
        "mhm",
        "mm",
        "uh",
        "uhh",
        "um",
        "umm",
        "youknow",
    }
)


def _plain(word: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", word.casefold())


def is_filler(word: str) -> bool:
    plain = _plain(word)
    return plain in FILLERS or plain.replace("'", "") == "youknow"


def kept_segments(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    return [s for s in transcript.get("segments") or [] if s.get("kept", True)]


def iter_words(segments: Iterable[dict[str, Any]], *, drop_fillers: bool) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for seg in segments:
        items = list(seg.get("words") or [])
        if not items:
            text = (seg.get("text") or "").strip()
            if text:
                items = [{"word": text, "start": float(seg["start"]), "end": float(seg["end"])}]
        for word in items:
            token = str(word.get("word") or "").strip()
            if not token:
                continue
            if drop_fillers and is_filler(token):
                continue
            words.append(
                {
                    "word": token,
                    "start": float(word["start"]),
                    "end": float(word["end"]),
                    "segment_id": int(seg.get("id") or 0),
                }
            )
    words.sort(key=lambda w: (w["start"], w["end"]))
    return words


def build_ranges(transcript: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, Any]]:
    drop = bool(settings.get("remove_fillers", True))
    tighten = bool(settings.get("tighten_pauses", True))
    split_pause = float(settings.get("split_pause_s") or 0.8)
    padding = float(settings.get("padding_s") or 0.08)
    merge_gap = float(settings.get("merge_gap_s") or 0.25)
    words = iter_words(kept_segments(transcript), drop_fillers=drop)
    if not words:
        return []

    runs: list[list[dict[str, Any]]] = [[words[0]]]
    for word in words[1:]:
        gap = word["start"] - runs[-1][-1]["end"]
        if tighten and gap > split_pause:
            runs.append([word])
        else:
            runs[-1].append(word)

    ranges: list[dict[str, Any]] = []
    for run in runs:
        start = max(0.0, run[0]["start"] - padding)
        end = run[-1]["end"] + padding
        if end - start < 0.08:
            continue
        text = " ".join(w["word"] for w in run).strip()
        ranges.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "text": text,
                "words": run,
            }
        )

    merged: list[dict[str, Any]] = []
    for item in ranges:
        if merged and item["start"] - merged[-1]["end"] <= merge_gap:
            prev = merged[-1]
            prev["end"] = item["end"]
            prev["text"] = (prev["text"] + " " + item["text"]).strip()
            prev["words"] = prev["words"] + item["words"]
        else:
            merged.append(item)

    while len(merged) > 80:
        merge_gap += 0.15
        tighter: list[dict[str, Any]] = []
        for item in merged:
            if tighter and item["start"] - tighter[-1]["end"] <= merge_gap:
                prev = tighter[-1]
                prev["end"] = item["end"]
                prev["text"] = (prev["text"] + " " + item["text"]).strip()
                prev["words"] = prev["words"] + item["words"]
            else:
                tighter.append(item)
        merged = tighter

    for item in merged:
        item["duration"] = round(item["end"] - item["start"], 3)
        item.pop("words", None)
    return merged


def remap_words(
    transcript: dict[str, Any],
    settings: dict[str, Any],
    ranges: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Words on the *output* timeline after keep / filler / pause edits or clip ranges."""
    ranges = ranges if ranges is not None else build_ranges(transcript, settings)
    drop = bool(settings.get("remove_fillers", True))
    words = iter_words(kept_segments(transcript), drop_fillers=drop)
    out: list[dict[str, Any]] = []
    cursor = 0.0
    for rng in ranges:
        for word in words:
            if word["end"] <= rng["start"] or word["start"] >= rng["end"]:
                continue
            start = max(word["start"], rng["start"])
            end = min(word["end"], rng["end"])
            out.append(
                {
                    "word": word["word"],
                    "start": round(cursor + (start - rng["start"]), 3),
                    "end": round(cursor + (end - rng["start"]), 3),
                }
            )
        cursor += rng["end"] - rng["start"]
    return out


def kept_stats(transcript: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    segs = transcript.get("segments") or []
    ranges = build_ranges(transcript, settings)
    kept = [s for s in segs if s.get("kept", True)]
    return {
        "lines": len(segs),
        "kept_lines": len(kept),
        "ranges": len(ranges),
        "kept_duration": round(sum(r["end"] - r["start"] for r in ranges), 3),
        "source_span": round((kept[-1]["end"] - kept[0]["start"]) if kept else 0.0, 3),
    }
