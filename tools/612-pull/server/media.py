"""Probe, stream, and QuickTime-export local media via FFmpeg."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterator, Optional

for _bin in ("/opt/homebrew/bin", "/usr/local/bin"):
    if _bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

MEDIA_EXT = {
    ".mkv",
    ".mp4",
    ".webm",
    ".mov",
    ".m4v",
    ".avi",
    ".wmv",
    ".flv",
    ".ts",
    ".m4a",
    ".mp3",
    ".opus",
    ".ogg",
    ".flac",
    ".wav",
    ".aac",
    ".mka",
}

QT_VIDEO = {"h264", "avc1", "hevc", "h265", "hev1"}
QT_AUDIO = {"aac", "mp3", "alac", "ac3"}
QT_CONTAINER = {"mp4", "mov", "m4v", "m4a", "mp3", "wav", "aiff", "caf"}

THUMB_DIR = Path.home() / ".grokpull-thumbs"
LIB_CACHE_PATH = Path.home() / ".grokpull-libcache.json"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}

_HAS_VIDEOTOOLBOX: Optional[bool] = None


def has_videotoolbox() -> bool:
    global _HAS_VIDEOTOOLBOX
    if _HAS_VIDEOTOOLBOX is None:
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        result = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True)
        _HAS_VIDEOTOOLBOX = "h264_videotoolbox" in (result.stdout or "")
    return _HAS_VIDEOTOOLBOX


def resolve_readable(path: str) -> Path:
    if not path or not isinstance(path, str):
        raise ValueError("Missing path")
    resolved = Path(os.path.expanduser(path)).resolve()
    if not resolved.is_file():
        raise FileNotFoundError(str(resolved))
    if resolved.suffix.lower() not in MEDIA_EXT | IMAGE_EXT:
        raise ValueError(f"Not a media file: {resolved.name}")
    return resolved


def resolve_media(path: str) -> Path:
    resolved = resolve_readable(path)
    if resolved.suffix.lower() not in MEDIA_EXT:
        raise ValueError(f"Not a media file: {resolved.name}")
    return resolved


def _ffprobe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or "ffprobe failed")
    return json.loads(result.stdout or "{}")


def _codec_name(stream: dict[str, Any]) -> str:
    return (stream.get("codec_name") or stream.get("codec_tag_string") or "").lower()


def _container_name(fmt: dict[str, Any], path: Path) -> str:
    raw = (fmt.get("format_name") or path.suffix.lstrip(".")).lower()
    if "matroska" in raw or "webm" in raw:
        return "mkv" if path.suffix.lower() == ".mkv" else "webm"
    if "mp4" in raw or "mov" in raw or "m4a" in raw:
        if path.suffix.lower() == ".m4a":
            return "m4a"
        return "mp4" if "mp4" in raw or path.suffix.lower() in {".mp4", ".m4v"} else "mov"
    return raw.split(",")[0] or path.suffix.lstrip(".").lower()


def probe(path: str) -> dict[str, Any]:
    resolved = resolve_media(path)
    data = _ffprobe(resolved)
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    vcodec = _codec_name(video) if video else ""
    acodec = _codec_name(audio) if audio else ""
    container = _container_name(fmt, resolved)
    duration = float(fmt.get("duration") or (video or {}).get("duration") or 0)
    width = int((video or {}).get("width") or 0)
    height = int((video or {}).get("height") or 0)
    pix = (video or {}).get("pix_fmt") or ""
    size = int(fmt.get("size") or resolved.stat().st_size)

    qt_ok = True
    reasons: list[str] = []
    if container not in QT_CONTAINER:
        qt_ok = False
        reasons.append(f"{container.upper()} container")
    if video and vcodec not in QT_VIDEO:
        qt_ok = False
        reasons.append(vcodec.upper() or "unknown video")
    if audio and acodec not in QT_AUDIO:
        qt_ok = False
        reasons.append(acodec.upper() or "unknown audio")

    direct = qt_ok and container in {"mp4", "mov", "m4v", "m4a", "mp3", "wav"}
    kind = "audio" if not video else "video"
    sidecar_dir = resolved.parent
    stem = resolved.stem
    subs = []
    for ext in (".vtt", ".srt"):
        for candidate in sidecar_dir.glob(f"{stem}*{ext}"):
            subs.append(str(candidate))
    transcript = ""
    for candidate in sidecar_dir.glob(f"{stem}*.txt"):
        if candidate.name.lower().endswith(".txt"):
            transcript = str(candidate)
            break

    label = " · ".join(x for x in (vcodec.upper() or None, acodec.upper() or None, container.upper()) if x)
    why = ""
    if not qt_ok:
        why = (
            f"QuickTime cannot play {label}. "
            "Apple’s player wants H.264 or HEVC + AAC inside MP4/MOV. "
            "Watch transcodes on the fly; Save QuickTime MP4 writes a copy Finder can open."
        )

    return {
        "path": str(resolved),
        "name": resolved.name,
        "folder": str(sidecar_dir),
        "kind": kind,
        "container": container,
        "vcodec": vcodec,
        "acodec": acodec,
        "width": width,
        "height": height,
        "pix_fmt": pix,
        "duration": duration,
        "size": size,
        "quicktime": qt_ok,
        "direct": direct,
        "label": label,
        "why": why,
        "reasons": reasons,
        "subtitles": subs,
        "transcript": transcript,
    }


def time_stamp(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m{s:02d}s"
    if m:
        return f"{m}m{s:02d}s"
    return f"{s}s"


def _lib_cache() -> dict[str, Any]:
    try:
        data = json.loads(LIB_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _save_lib_cache(cache: dict[str, Any]) -> None:
    try:
        LIB_CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
    except Exception:
        pass


def _cached_probe(path: Path) -> dict[str, Any]:
    try:
        stat = path.stat()
    except OSError:
        raise
    key = f"{path}:{stat.st_mtime_ns}:{stat.st_size}"
    cache = _lib_cache()
    hit = cache.get(key)
    if isinstance(hit, dict) and hit.get("path") == str(path):
        return hit
    info = probe(str(path))
    slim = {
        "path": info["path"],
        "name": path.stem,
        "file": path.name,
        "folder": info["folder"],
        "ext": path.suffix.lower().lstrip("."),
        "size": info["size"],
        "mtime": stat.st_mtime,
        "duration": info["duration"],
        "vcodec": info["vcodec"],
        "acodec": info["acodec"],
        "width": info["width"],
        "height": info["height"],
        "quicktime": info["quicktime"],
        "kind": info["kind"],
        "label": info["label"],
    }
    cache[key] = slim
    if len(cache) > 400:
        cache = dict(list(cache.items())[-300:])
    _save_lib_cache(cache)
    return slim


def list_library(folders: list[str]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for folder in folders:
        root = Path(os.path.expanduser(folder or "")).resolve()
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            rel = Path(dirpath).relative_to(root)
            if len(rel.parts) > 4:
                continue
            for name in filenames:
                path = Path(dirpath) / name
                if path.suffix.lower() not in MEDIA_EXT:
                    continue
                key = str(path)
                if key in seen:
                    continue
                seen.add(key)
                try:
                    found.append(_cached_probe(path))
                except Exception:
                    continue
    found.sort(key=lambda item: item.get("mtime") or 0, reverse=True)
    return found[:200]


def _video_encode_args() -> list[str]:
    if has_videotoolbox():
        return ["-c:v", "h264_videotoolbox", "-b:v", "6M", "-pix_fmt", "yuv420p", "-tag:v", "avc1"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-tag:v", "avc1"]


def transcode_command(path: Path, start: float = 0.0, end: float | None = None, for_file: bool = False) -> list[str]:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if start and start > 0.05:
        cmd.extend(["-ss", f"{start:.3f}"])
    if end is not None and end > start:
        cmd.extend(["-to", f"{end:.3f}"])
    cmd.extend(["-i", str(path), "-map", "0:v:0?", "-map", "0:a:0?"])
    info = probe(str(path))
    if info["kind"] == "video":
        cmd.extend(_video_encode_args())
        cmd.extend(["-c:a", "aac", "-b:a", "192k", "-ac", "2"])
    else:
        cmd.extend(["-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2"])
    if for_file:
        cmd.extend(["-movflags", "+faststart"])
    else:
        cmd.extend(["-movflags", "frag_keyframe+empty_moov+default_base_moof"])
        cmd.extend(["-f", "mp4", "pipe:1"])
    return cmd


def stream_bytes(path: str, start: float = 0.0) -> Iterator[bytes]:
    resolved = resolve_media(path)
    cmd = transcode_command(resolved, start=start, for_file=False)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(64 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        if proc.poll() is None:
            proc.kill()
        try:
            proc.wait(timeout=2)
        except Exception:
            pass


def export_quicktime(path: str, start: float = 0.0, end: float | None = None) -> dict[str, Any]:
    resolved = resolve_media(path)
    suffix = ""
    if start or end:
        suffix = f".{time_stamp(start)}-{time_stamp(end or 0)}"
        dest = resolved.with_name(f"{resolved.stem}{suffix}.quicktime.mp4")
    else:
        dest = resolved.with_name(f"{resolved.stem}.quicktime.mp4")
    cmd = transcode_command(resolved, start=start, end=end, for_file=True)
    cmd.append(str(dest))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if result.returncode != 0 or not dest.is_file():
        raise RuntimeError(result.stderr or result.stdout or "Export failed")
    return {"path": str(dest), "size": dest.stat().st_size, "copied": False}


def export_clip(path: str, start: float, end: float, kind: str = "master") -> dict[str, Any]:
    resolved = resolve_media(path)
    if end <= start:
        raise ValueError("Out point must be after in point.")
    start = max(0.0, start)
    label = f"{time_stamp(start)}-{time_stamp(end)}"
    if kind == "quicktime":
        return {**export_quicktime(path, start=start, end=end), "kind": "quicktime"}

    dest = resolved.with_name(f"{resolved.stem}.{label}.mkv")
    copy_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(resolved),
        "-map",
        "0",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        str(dest),
    ]
    result = subprocess.run(copy_cmd, capture_output=True, text=True, timeout=600)
    if result.returncode == 0 and dest.is_file() and dest.stat().st_size > 0:
        return {"path": str(dest), "size": dest.stat().st_size, "copied": True, "kind": "master"}
    cmd = transcode_command(resolved, start=start, end=end, for_file=True)
    dest = resolved.with_name(f"{resolved.stem}.{label}.mkv")
    cmd.append(str(dest))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if result.returncode != 0 or not dest.is_file():
        raise RuntimeError(result.stderr or result.stdout or "Clip failed")
    return {"path": str(dest), "size": dest.stat().st_size, "copied": False, "kind": "master"}


def grab_frame(path: str, time: float) -> dict[str, Any]:
    resolved = resolve_media(path)
    time = max(0.0, time)
    dest = resolved.with_name(f"{resolved.stem}.frame-{time_stamp(time)}.png")
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(resolved),
        "-ss",
        f"{time:.3f}",
        "-frames:v",
        "1",
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0 or not dest.is_file():
        raise RuntimeError(result.stderr or result.stdout or "Frame grab failed")
    return {"path": str(dest), "size": dest.stat().st_size, "time": time}


def grokedit_url(image_path: str) -> str:
    from urllib.parse import quote

    return f"http://127.0.0.1:5174/?image={quote(image_path)}"


def grokedit_running() -> bool:
    try:
        import urllib.request

        urllib.request.urlopen("http://127.0.0.1:5174/", timeout=0.4)
        return True
    except Exception:
        return False


def thumbnail_file(path: str) -> Path:
    resolved = resolve_media(path)
    info = probe(str(resolved))
    if info["kind"] != "video":
        raise ValueError("No video stream")
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{resolved}:{resolved.stat().st_mtime_ns}".encode()).hexdigest()[:16]
    dest = THUMB_DIR / f"{key}.jpg"
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    seek = 1.0 if (info["duration"] or 0) > 3 else 0.0
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{seek:.2f}",
        "-i",
        str(resolved),
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-2",
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or not dest.is_file():
        raise RuntimeError(result.stderr or "Thumbnail failed")
    return dest


def read_text_file(path: str, limit: int = 20_000) -> str:
    resolved = Path(os.path.expanduser(path)).resolve()
    if not resolved.is_file():
        raise FileNotFoundError(str(resolved))
    if resolved.suffix.lower() not in {".txt", ".vtt", ".srt"}:
        raise ValueError("Not a text sidecar")
    return resolved.read_text(encoding="utf-8", errors="replace")[:limit]
