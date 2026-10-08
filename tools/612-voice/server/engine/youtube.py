from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from server.config import MAX_PROMPT_SECONDS, PROMPT_SR


def parse_time_to_seconds(value: str) -> float:
    value = (value or "").strip()
    if not value:
        return 0.0
    if ":" not in value:
        return max(0.0, float(value))
    parts = value.split(":")
    if len(parts) == 2:
        return max(0.0, int(parts[0]) * 60 + float(parts[1]))
    if len(parts) == 3:
        return max(0.0, int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2]))
    raise ValueError(f"Invalid time format: {value}")


def find_ffmpeg() -> str:
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import static_ffmpeg

        static_ffmpeg.add_paths()
        system = shutil.which("ffmpeg")
        if system:
            return system
    except Exception:
        pass
    raise RuntimeError("ffmpeg not found. Install ffmpeg or pip install static-ffmpeg")


def postprocess_prompt(wav_path: Path, max_duration: float = MAX_PROMPT_SECONDS) -> Path:
    audio, sr = librosa.load(str(wav_path), sr=None, mono=True)
    if audio.size == 0:
        raise ValueError("Audio is empty")
    audio, _ = librosa.effects.trim(audio, top_db=30)
    if audio.size == 0:
        raise ValueError("Audio is silent after trimming")
    if sr != PROMPT_SR:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=PROMPT_SR)
        sr = PROMPT_SR
    max_samples = int(max(5.0, min(max_duration, MAX_PROMPT_SECONDS)) * sr)
    audio = audio[:max_samples]
    peak = float(np.max(np.abs(audio)))
    if peak > 0:
        audio = audio / peak * 0.95
    sf.write(str(wav_path), audio, sr, subtype="PCM_16")
    return wav_path


def download_voice_sample(
    url: str,
    out_path: Path,
    start: str = "0",
    duration: float = 15.0,
) -> tuple[Path, str]:
    if not url.strip():
        raise ValueError("YouTube URL is required")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    start_seconds = parse_time_to_seconds(start)
    duration = max(5.0, min(30.0, float(duration)))
    end_seconds = start_seconds + duration
    ffmpeg_path = find_ffmpeg()

    with tempfile.TemporaryDirectory(prefix="yt-voice-") as tmpdir:
        tmp = Path(tmpdir)
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": str(tmp / "%(id)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "download_sections": [f"*{start_seconds}-{end_seconds}"],
            "ffmpeg_location": str(Path(ffmpeg_path).parent),
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "wav", "preferredquality": "192"}
            ],
        }
        import yt_dlp

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = (info or {}).get("title", "YouTube video")
        wav_files = sorted(tmp.glob("*.wav"))
        if not wav_files:
            raise RuntimeError("No audio file produced from YouTube download")
        shutil.copy2(wav_files[0], out_path)

    postprocess_prompt(out_path, duration)
    return out_path, title
