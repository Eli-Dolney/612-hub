"""Single-URL download via yt-dlp. Not a GrokPull clone — just enough to feed an order."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Callable, Optional

from server.config import SUPPORTED

ProgressFn = Callable[[float, str], None]
StopFn = Callable[[], bool]

URL_OK = re.compile(r"^https?://", re.I)


def ytdlp_available() -> bool:
    try:
        import yt_dlp  # noqa: F401

        return True
    except Exception:
        return shutil.which("yt-dlp") is not None


def validate_url(url: str) -> str:
    text = (url or "").strip()
    if not URL_OK.match(text):
        raise ValueError("Paste an http(s) video URL")
    return text


def _pick_file(info: dict, ydl, dest: Path) -> Path:
    requested = info.get("requested_downloads") or []
    if requested:
        raw = requested[0].get("filepath") or requested[0].get("filename")
        if raw:
            path = Path(raw)
            if path.is_file():
                return path
    name = Path(ydl.prepare_filename(info))
    for cand in (
        name,
        name.with_suffix(".mp4"),
        name.with_suffix(".mkv"),
        name.with_suffix(".webm"),
        name.with_suffix(".mov"),
    ):
        if cand.is_file():
            return cand
    hits = sorted(
        (p for p in dest.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if hits:
        return hits[0]
    raise RuntimeError("Download finished but no video file showed up")


def pull_url(
    url: str,
    dest: Path,
    progress: Optional[ProgressFn] = None,
    stop: Optional[StopFn] = None,
) -> Path:
    try:
        import yt_dlp
    except Exception as exc:
        raise RuntimeError("yt-dlp is not installed. Run: .venv/bin/pip install yt-dlp") from exc

    target = validate_url(url)
    dest.mkdir(parents=True, exist_ok=True)

    def hook(status: dict) -> None:
        if stop and stop():
            raise RuntimeError("Cancelled")
        state = status.get("status")
        if state == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
            got = status.get("downloaded_bytes") or 0
            pct = (got / total) if total else 0.0
            speed = status.get("speed") or 0
            note = "Downloading"
            if speed:
                note = f"Downloading · {speed / 1_000_000:.1f} MB/s"
            if progress:
                progress(min(0.95, pct), note)
        elif state == "finished" and progress:
            progress(0.97, "Merging")

    opts = {
        "outtmpl": str(dest / "%(title).80s [%(id)s].%(ext)s"),
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "overwrites": True,
        "restrictfilenames": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target, download=True)
    if not info:
        raise RuntimeError("yt-dlp returned nothing")
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise RuntimeError("Playlist was empty")
        info = entries[0]
    path = _pick_file(info, ydl, dest)
    if progress:
        progress(1.0, path.name)
    return path
