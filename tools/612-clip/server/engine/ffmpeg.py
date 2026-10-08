"""FFmpeg / ffprobe helpers. Homebrew bins are added to PATH on macOS."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

for _bin in ("/opt/homebrew/bin", "/usr/local/bin"):
    if _bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

_HAS_VT: Optional[bool] = None


def which_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg is not on PATH. Install it with `brew install ffmpeg`.")
    return path


def which_ffprobe() -> str:
    path = shutil.which("ffprobe")
    if not path:
        raise RuntimeError("ffprobe is not on PATH. Install it with `brew install ffmpeg`.")
    return path


def has_videotoolbox() -> bool:
    global _HAS_VT
    if _HAS_VT is None:
        result = subprocess.run(
            [which_ffmpeg(), "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
        )
        _HAS_VT = "h264_videotoolbox" in (result.stdout or "")
    return bool(_HAS_VT)


def run(cmd: list[str], timeout: int = 3600) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "ffmpeg failed").strip()
        raise RuntimeError(err[-1200:])
    return result


def probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            which_ffprobe(),
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
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or "ffprobe failed")
    data = json.loads(result.stdout or "{}")
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fmt = data.get("format") or {}
    duration = float(fmt.get("duration") or (video or {}).get("duration") or 0)
    fps = 0.0
    if video and video.get("avg_frame_rate") and video["avg_frame_rate"] != "0/0":
        num, den = video["avg_frame_rate"].split("/")
        den_f = float(den) or 1.0
        fps = float(num) / den_f
    return {
        "duration": duration,
        "width": int(video.get("width") or 0) if video else 0,
        "height": int(video.get("height") or 0) if video else 0,
        "fps": round(fps, 3),
        "codec": (video or {}).get("codec_name"),
        "audio_codec": (audio or {}).get("codec_name"),
        "has_audio": audio is not None,
        "has_video": video is not None,
        "size": int(fmt.get("size") or path.stat().st_size),
        "format": fmt.get("format_name"),
        "bit_rate": int(fmt.get("bit_rate") or 0),
    }


def video_args(portrait: bool = False) -> list[str]:
    if has_videotoolbox():
        bitrate = "8M" if portrait else "10M"
        return ["-c:v", "h264_videotoolbox", "-b:v", bitrate, "-pix_fmt", "yuv420p"]
    return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
    ]


def audio_args(has_audio: bool) -> list[str]:
    if not has_audio:
        return ["-an"]
    return ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]


def grab_frame(src: Path, dest: Path, time: float) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            which_ffmpeg(),
            "-y",
            "-ss",
            f"{max(0.0, time):.3f}",
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(dest),
        ],
        timeout=60,
    )
    if not dest.is_file() or dest.stat().st_size == 0:
        raise RuntimeError("Frame grab produced an empty file")
    return dest


def extract_wav(
    src: Path,
    dest: Path,
    *,
    start: float = 0.0,
    duration: Optional[float] = None,
) -> Path:
    """16 kHz mono PCM for Whisper. Avoids PyAV choking on Opus-in-MP4."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [which_ffmpeg(), "-y"]
    if start and start > 0.02:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if duration and duration > 0.05:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dest)]
    run(cmd, timeout=300)
    if not dest.is_file() or dest.stat().st_size == 0:
        raise RuntimeError("Could not extract audio for Whisper")
    return dest
