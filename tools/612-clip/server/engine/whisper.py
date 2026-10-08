"""Local Whisper via faster-whisper. Word timestamps, no cloud."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

from server.config import WHISPER_CACHE
from server.engine.ffmpeg import extract_wav

ProgressFn = Callable[[float, str], None]
StopFn = Callable[[], bool]

_MODELS: dict[str, Any] = {}


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


def device_name() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "cpu+int8 (Apple Silicon)"
    except Exception:
        pass
    return "cpu"


def _load(model_name: str):
    if model_name in _MODELS:
        return _MODELS[model_name]
    from faster_whisper import WhisperModel

    WHISPER_CACHE.mkdir(parents=True, exist_ok=True)
    compute = "int8"
    try:
        import torch

        if torch.cuda.is_available():
            compute = "float16"
    except Exception:
        pass
    _MODELS[model_name] = WhisperModel(
        model_name,
        device="cuda" if compute == "float16" else "cpu",
        compute_type=compute,
        download_root=str(WHISPER_CACHE),
    )
    return _MODELS[model_name]


def _collect(
    model,
    audio: Path,
    *,
    vad_filter: bool,
    duration: float,
    progress: Optional[ProgressFn],
    stop: Optional[StopFn],
    progress_note: str,
) -> tuple[list[dict[str, Any]], str]:
    segments_iter, info = model.transcribe(
        str(audio),
        word_timestamps=True,
        vad_filter=vad_filter,
        language=None,
        condition_on_previous_text=True,
    )
    language = getattr(info, "language", None) or "en"
    duration = float(getattr(info, "duration", None) or duration or 0.0)
    segments: list[dict[str, Any]] = []
    for index, seg in enumerate(segments_iter):
        if stop and stop():
            raise RuntimeError("Cancelled")
        words = []
        for word in getattr(seg, "words", None) or []:
            token = (word.word or "").strip()
            if not token:
                continue
            words.append(
                {
                    "word": token,
                    "start": round(float(word.start or seg.start), 3),
                    "end": round(float(word.end or seg.end), 3),
                }
            )
        text = (seg.text or "").strip()
        if not text and words:
            text = " ".join(w["word"] for w in words)
        if not text:
            continue
        segments.append(
            {
                "id": index,
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": text,
                "kept": True,
                "words": words,
            }
        )
        if duration > 0 and progress:
            ratio = min(0.97, 0.18 + 0.8 * (float(seg.end) / duration))
            progress(ratio, f"{progress_note} · {len(segments)} lines · {seg.end:.0f}s")
    return segments, language


def transcribe(
    src: Path,
    *,
    model_name: str = "base",
    duration: float = 0.0,
    vad_filter: str = "auto",
    wav_path: Optional[Path] = None,
    progress: Optional[ProgressFn] = None,
    stop: Optional[StopFn] = None,
    start: float = 0.0,
    end: Optional[float] = None,
) -> dict[str, Any]:
    if not src.exists():
        raise FileNotFoundError(src)
    if progress:
        progress(0.04, f"Loading Whisper {model_name}")
    model = _load(model_name)
    wav = wav_path or src.with_name("speech.wav")
    offset = max(0.0, float(start or 0))
    clip = None
    if end is not None and float(end) > offset + 0.05:
        clip = float(end) - offset
    span = clip if clip else duration
    if progress:
        progress(0.08, "Extracting audio" + (f" · {clip:.0f}s" if clip else ""))
    extract_wav(src, wav, start=offset, duration=clip)
    use_vad = vad_filter != "off"
    if progress:
        progress(0.16, "Transcribing" + (" (VAD)" if use_vad else ""))
    segments, language = _collect(
        model,
        wav,
        vad_filter=use_vad,
        duration=span,
        progress=progress,
        stop=stop,
        progress_note="Whisper",
    )
    used_vad = "on" if use_vad else "off"
    if not segments and vad_filter == "auto":
        if progress:
            progress(0.2, "No speech with VAD — retrying full audio")
        segments, language = _collect(
            model,
            wav,
            vad_filter=False,
            duration=span,
            progress=progress,
            stop=stop,
            progress_note="Whisper (no VAD)",
        )
        used_vad = "off"
    if offset:
        for seg in segments:
            seg["start"] = round(float(seg["start"]) + offset, 3)
            seg["end"] = round(float(seg["end"]) + offset, 3)
            for word in seg.get("words") or []:
                word["start"] = round(float(word["start"]) + offset, 3)
                word["end"] = round(float(word["end"]) + offset, 3)
    if progress:
        progress(1.0, f"{len(segments)} lines" if segments else "No speech found")
    return {
        "language": language,
        "model": model_name,
        "vad": used_vad,
        "segments": segments,
        "window_start": offset,
        "window_end": offset + clip if clip else None,
    }
