from __future__ import annotations

import random
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

import numpy as np
import soundfile as sf

from server.config import LUFS_TARGET, TARGET_SR
from server.engine.qc import QCResult, check_clip

_model = None
_model_error: Optional[str] = None
_device = "cpu"


def detect_device() -> str:
    try:
        import torch

        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def device_name() -> str:
    return detect_device()


def chatterbox_available() -> bool:
    try:
        import chatterbox.tts  # noqa: F401

        return True
    except Exception:
        return False


def macos_say_available() -> bool:
    return shutil.which("say") is not None


def get_model():
    global _model, _model_error, _device
    if _model is not None:
        return _model
    try:
        from chatterbox.tts import ChatterboxTTS

        _device = detect_device()
        _model = ChatterboxTTS.from_pretrained(device=_device)
        _model_error = None
        return _model
    except Exception as exc:
        _model_error = str(exc)
        raise


def model_error() -> Optional[str]:
    return _model_error


def _to_numpy(wav: Any) -> np.ndarray:
    if hasattr(wav, "detach"):
        wav = wav.squeeze(0).detach().cpu().numpy()
    audio = np.asarray(wav, dtype=np.float32).squeeze()
    if audio.ndim != 1:
        audio = audio.reshape(-1)
    return audio


def postprocess(wav: np.ndarray, sr: int, to_48k: bool, lufs_target: float) -> tuple[np.ndarray, int]:
    target_sr = sr
    audio = np.asarray(wav, dtype=np.float32).squeeze()
    if to_48k and target_sr != TARGET_SR:
        import librosa

        audio = librosa.resample(audio, orig_sr=target_sr, target_sr=TARGET_SR).astype(np.float32)
        target_sr = TARGET_SR
    if lufs_target:
        try:
            import pyloudnorm as pyln

            meter = pyln.Meter(target_sr)
            loud = meter.integrated_loudness(audio)
            if np.isfinite(loud):
                audio = (audio * (10 ** ((lufs_target - loud) / 20.0))).astype(np.float32)
        except Exception:
            pass
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = (audio / peak * 0.98).astype(np.float32)
    return audio, target_sr


def generate_say(text: str, voice: str = "Samantha") -> tuple[np.ndarray, int]:
    if not macos_say_available():
        raise RuntimeError("macOS say is not available")
    tmp = Path(tempfile.mkstemp(suffix=".wav")[1])
    try:
        subprocess.run(
            ["say", "-v", voice, "-o", str(tmp), "--data-format=LEF32@22050", text],
            check=True,
            capture_output=True,
        )
        audio, sr = sf.read(str(tmp), always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return audio.astype(np.float32), int(sr)
    finally:
        tmp.unlink(missing_ok=True)


def generate_chatterbox(
    text: str,
    prompt_path: Optional[Path],
    exaggeration: float,
    cfg_weight: float,
    temperature: float,
) -> tuple[np.ndarray, int]:
    model = get_model()
    if prompt_path and Path(prompt_path).exists():
        try:
            model.prepare_conditionals(str(prompt_path), exaggeration=exaggeration)
        except Exception:
            pass
    kwargs = {
        "exaggeration": exaggeration,
        "cfg_weight": cfg_weight,
        "temperature": temperature,
    }
    try:
        wav = model.generate(
            text,
            audio_prompt_path=str(prompt_path) if prompt_path else None,
            **kwargs,
        )
    except TypeError:
        wav = model.generate(text, **kwargs)
    return _to_numpy(wav), int(getattr(model, "sr", 24000))


def generate_with_qc(
    *,
    engine: str,
    text: str,
    prompt_path: Optional[Path],
    exaggeration: float,
    cfg_weight: float,
    temperature: float,
    to_48k: bool = True,
    lufs_target: float = LUFS_TARGET,
    validate: bool = True,
    max_retries: int = 2,
    say_voice: str = "Samantha",
) -> tuple[np.ndarray, int, QCResult, int]:
    import torch

    attempts = max_retries + 1
    best_wav: Optional[np.ndarray] = None
    best_sr = TARGET_SR
    best_qc = QCResult(False, ["no attempt"])
    retries = 0

    for attempt in range(attempts):
        if attempt:
            retries = attempt
            try:
                torch.manual_seed(random.randint(0, 2**31 - 1))
            except Exception:
                pass
        if engine == "macos":
            wav, sr = generate_say(text, say_voice)
        else:
            wav, sr = generate_chatterbox(text, prompt_path, exaggeration, cfg_weight, temperature)
        wav, sr = postprocess(wav, sr, to_48k, lufs_target)
        qc = check_clip(wav, sr, text) if validate else QCResult(True, [], float(wav.size) / sr)
        if best_wav is None or len(qc.issues) < len(best_qc.issues):
            best_wav, best_sr, best_qc = wav, sr, qc
        if qc.passed:
            return wav, sr, qc, retries

    assert best_wav is not None
    return best_wav, best_sr, best_qc, retries
