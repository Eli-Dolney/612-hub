from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
import soundfile as sf

from server.config import (
    EMPHASIS,
    LUFS_TARGET,
    SHOWS_DIR,
    SPEAKERS,
    TARGET_SR,
    VOICES_DIR,
    VOICES_INDEX,
)
from server.engine.concat import concat_paths
from server.engine.dialogue import parse_dialogue
from server.engine.effects import process_file
from server.engine.split import split_script_text
from server.engine.tts import chatterbox_available, device_name, generate_with_qc, macos_say_available
from server.engine.youtube import download_voice_sample, postprocess_prompt

Progress = Callable[[float, str], None]


def slugify(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", name.strip()).strip("-").lower()
    return slug or f"item-{uuid.uuid4().hex[:6]}"


def peaks_from_wav(path: Path, buckets: int = 160) -> list[float]:
    try:
        y, _sr = sf.read(str(path), always_2d=False)
    except Exception:
        return []
    if getattr(y, "ndim", 1) > 1:
        y = y.mean(axis=1)
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0:
        return []
    step = max(1, y.size // buckets)
    out = [float(np.max(np.abs(y[i : i + step]))) for i in range(0, y.size, step)]
    mx = max(out) or 1.0
    return [min(1.0, v / mx) for v in out[:buckets]]


def duration_of(path: Path) -> float:
    try:
        info = sf.info(str(path))
        return float(info.frames) / float(info.samplerate)
    except Exception:
        return 0.0


def ensure_dirs() -> None:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    SHOWS_DIR.mkdir(parents=True, exist_ok=True)
    if not VOICES_INDEX.exists():
        VOICES_INDEX.write_text("[]", encoding="utf-8")


def load_voices() -> list[dict[str, Any]]:
    ensure_dirs()
    try:
        data = json.loads(VOICES_INDEX.read_text(encoding="utf-8"))
    except Exception:
        data = []
    return data if isinstance(data, list) else []


def save_voices(voices: list[dict[str, Any]]) -> None:
    ensure_dirs()
    VOICES_INDEX.write_text(json.dumps(voices, indent=2), encoding="utf-8")


def voice_by_id(voice_id: str) -> Optional[dict[str, Any]]:
    for voice in load_voices():
        if voice.get("id") == voice_id:
            return voice
    return None


def voice_path(voice: dict[str, Any]) -> Optional[Path]:
    rel = voice.get("prompt")
    if not rel:
        return None
    path = Path(rel)
    if not path.is_absolute():
        path = (VOICES_DIR.parent / path).resolve() if str(rel).startswith("voices/") else (VOICES_DIR / path).resolve()
    return path if path.exists() else None


def add_voice_from_file(src: Path, name: str, source: str = "upload") -> dict[str, Any]:
    ensure_dirs()
    voice_id = slugify(name)
    dest = VOICES_DIR / f"{voice_id}.wav"
    n = 2
    while dest.exists() or voice_by_id(voice_id):
        voice_id = f"{slugify(name)}-{n}"
        dest = VOICES_DIR / f"{voice_id}.wav"
        n += 1
    shutil.copy2(src, dest)
    postprocess_prompt(dest)
    voice = {
        "id": voice_id,
        "name": name.strip() or voice_id,
        "prompt": f"voices/{dest.name}",
        "exaggeration": 0.5,
        "cfg_weight": 0.5,
        "temperature": 0.8,
        "source": source,
        "duration": round(duration_of(dest), 2),
    }
    voices = load_voices()
    voices.append(voice)
    save_voices(voices)
    return public_voice(voice)


def add_voice_from_youtube(url: str, name: str, start: str, duration: float) -> dict[str, Any]:
    ensure_dirs()
    voice_id = slugify(name or "youtube-voice")
    dest = VOICES_DIR / f"{voice_id}.wav"
    n = 2
    while dest.exists() or voice_by_id(voice_id):
        voice_id = f"{slugify(name or 'youtube-voice')}-{n}"
        dest = VOICES_DIR / f"{voice_id}.wav"
        n += 1
    path, title = download_voice_sample(url, dest, start, duration)
    voice = {
        "id": voice_id,
        "name": name.strip() or title[:48],
        "prompt": f"voices/{path.name}",
        "exaggeration": 0.5,
        "cfg_weight": 0.5,
        "temperature": 0.8,
        "source": "youtube",
        "youtube": url,
        "duration": round(duration_of(path), 2),
    }
    voices = load_voices()
    voices.append(voice)
    save_voices(voices)
    return public_voice(voice)


def update_voice(voice_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    voices = load_voices()
    for voice in voices:
        if voice.get("id") == voice_id:
            for key in ("name", "exaggeration", "cfg_weight", "temperature"):
                if key in fields and fields[key] is not None:
                    voice[key] = fields[key]
            save_voices(voices)
            return public_voice(voice)
    raise FileNotFoundError(voice_id)


def delete_voice(voice_id: str) -> None:
    voices = load_voices()
    keep = []
    for voice in voices:
        if voice.get("id") == voice_id:
            path = voice_path(voice)
            if path and path.exists():
                path.unlink()
        else:
            keep.append(voice)
    save_voices(keep)


def public_voice(voice: dict[str, Any]) -> dict[str, Any]:
    path = voice_path(voice)
    return {
        **voice,
        "has_prompt": bool(path),
        "peaks": peaks_from_wav(path) if path else [],
    }


def show_dir(name: str) -> Path:
    safe = slugify(name)
    path = SHOWS_DIR / safe
    if not path.exists():
        raise FileNotFoundError(name)
    return path


def show_config_path(name: str) -> Path:
    return show_dir(name) / "show.json"


def load_show(name: str) -> dict[str, Any]:
    path = show_config_path(name)
    return json.loads(path.read_text(encoding="utf-8"))


def save_show(cfg: dict[str, Any]) -> dict[str, Any]:
    name = cfg["name"]
    path = SHOWS_DIR / name / "show.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    (path.parent / "lines").mkdir(exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def default_show(name: str) -> dict[str, Any]:
    voices = load_voices()
    first = voices[0]["id"] if voices else ""
    return {
        "name": name,
        "title": name.replace("-", " ").title(),
        "mode": "script",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "engine": "chatterbox" if chatterbox_available() else "macos",
        "cast": {slot: first for slot in SPEAKERS},
        "settings": {
            "gap": 0.35,
            "crossfade_ms": 40,
            "to_48k": True,
            "lufs": LUFS_TARGET,
            "qc": True,
            "retries": 2,
        },
        "lines": [],
        "takes": [],
        "mix": None,
        "story_text": "Speaker 1: Welcome back. This whole episode stays on this Mac.\nSpeaker 2: Clone a voice, render the script, concat a mix. No cloud bill.",
    }


def create_show(title: str) -> dict[str, Any]:
    ensure_dirs()
    name = slugify(title or "untitled-show")
    dest = SHOWS_DIR / name
    n = 2
    while dest.exists():
        name = f"{slugify(title or 'untitled-show')}-{n}"
        dest = SHOWS_DIR / name
        n += 1
    cfg = default_show(name)
    cfg["title"] = title.strip() or cfg["title"]
    save_show(cfg)
    return show_summary(cfg)


def delete_show(name: str) -> None:
    path = show_dir(name)
    shutil.rmtree(path, ignore_errors=True)


def line_wav(cfg: dict[str, Any], index: int) -> Path:
    return SHOWS_DIR / cfg["name"] / "lines" / f"{index:03d}.wav"


def show_summary(cfg: dict[str, Any]) -> dict[str, Any]:
    lines = cfg.get("lines") or []
    rendered = sum(1 for ln in lines if line_wav(cfg, ln["index"]).exists())
    mix = SHOWS_DIR / cfg["name"] / "mix.wav"
    return {
        "name": cfg["name"],
        "title": cfg.get("title") or cfg["name"],
        "mode": cfg.get("mode") or "script",
        "engine": cfg.get("engine") or "chatterbox",
        "lines": len(lines),
        "rendered": rendered,
        "has_mix": mix.exists(),
        "created_at": cfg.get("created_at"),
        "duration": duration_of(mix) if mix.exists() else None,
    }


def list_shows() -> list[dict[str, Any]]:
    ensure_dirs()
    out = []
    for folder in sorted(SHOWS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if (folder / "show.json").exists():
            out.append(show_summary(load_show(folder.name)))
    return out


def show_detail(name: str) -> dict[str, Any]:
    cfg = load_show(name)
    lines_out = []
    for ln in cfg.get("lines") or []:
        path = line_wav(cfg, ln["index"])
        item = dict(ln)
        item["has_audio"] = path.exists()
        item["duration"] = duration_of(path) if path.exists() else None
        item["file"] = f"lines/{path.name}" if path.exists() else None
        item["peaks"] = peaks_from_wav(path) if path.exists() else []
        lines_out.append(item)
    mix = SHOWS_DIR / cfg["name"] / "mix.wav"
    return {
        **show_summary(cfg),
        "cast": cfg.get("cast") or {},
        "settings": cfg.get("settings") or {},
        "story_text": cfg.get("story_text") or "",
        "lines": lines_out,
        "takes": cfg.get("takes") or [],
        "mix_file": "mix.wav" if mix.exists() else None,
        "mix_peaks": peaks_from_wav(mix) if mix.exists() else [],
        "voices": [public_voice(v) for v in load_voices()],
    }


def patch_show(name: str, body: dict[str, Any]) -> dict[str, Any]:
    cfg = load_show(name)
    for key in ("title", "mode", "engine", "story_text"):
        if key in body and body[key] is not None:
            cfg[key] = body[key]
    if "cast" in body and isinstance(body["cast"], dict):
        cfg["cast"] = {**cfg.get("cast", {}), **body["cast"]}
    if "settings" in body and isinstance(body["settings"], dict):
        cfg["settings"] = {**cfg.get("settings", {}), **body["settings"]}
    if "lines" in body and isinstance(body["lines"], list):
        cfg["lines"] = normalize_lines(body["lines"])
    save_show(cfg)
    return show_detail(name)


def normalize_lines(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, row in enumerate(rows, start=1):
        text = (row.get("text") or "").strip()
        if not text:
            continue
        raw_speaker = str(row.get("speaker") or "A").strip().upper()
        speaker = raw_speaker if raw_speaker in SPEAKERS else (raw_speaker[:1] if raw_speaker[:1] in SPEAKERS else "A")
        out.append(
            {
                "index": i,
                "text": text,
                "speaker": speaker,
                "voice": row.get("voice") or "",
                "filename": row.get("filename") or f"{i:03d}",
                "exaggeration": float(row.get("exaggeration") or 0.5),
                "cfg_weight": float(row.get("cfg_weight") or 0.5),
                "temperature": float(row.get("temperature") or 0.8),
            }
        )
    return out


def set_lines_from_text(name: str, text: str, mode: str = "sentence") -> dict[str, Any]:
    cfg = load_show(name)
    chunks = split_script_text(text, mode=mode if mode in {"sentence", "paragraph", "char_limit"} else "sentence")
    default_voice = next(iter((cfg.get("cast") or {}).values()), "")
    cfg["lines"] = normalize_lines(
        [{"text": chunk, "speaker": "A", "voice": default_voice} for chunk in chunks]
    )
    cfg["mode"] = "script"
    save_show(cfg)
    return show_detail(name)


def set_lines_from_story(name: str, text: str | None = None) -> dict[str, Any]:
    cfg = load_show(name)
    story = text if text is not None else cfg.get("story_text") or ""
    cfg["story_text"] = story
    parsed = parse_dialogue(story)
    cast = cfg.get("cast") or {}
    cfg["lines"] = normalize_lines(
        [
            {
                "text": row["text"],
                "speaker": row["speaker"],
                "voice": cast.get(row["speaker"], ""),
            }
            for row in parsed
        ]
    )
    cfg["mode"] = "story"
    save_show(cfg)
    return show_detail(name)


def apply_emphasis(name: str, indices: list[int], preset: str) -> dict[str, Any]:
    if preset not in EMPHASIS:
        raise ValueError(f"Unknown emphasis {preset}")
    exag, cfg_w, temp = EMPHASIS[preset]
    cfg = load_show(name)
    wanted = set(indices)
    for ln in cfg.get("lines") or []:
        if ln["index"] in wanted:
            ln["exaggeration"] = exag
            ln["cfg_weight"] = cfg_w
            ln["temperature"] = temp
    save_show(cfg)
    return show_detail(name)


def resolve_line_voice(cfg: dict[str, Any], line: dict[str, Any]) -> tuple[Optional[Path], dict[str, Any]]:
    voice_id = line.get("voice") or (cfg.get("cast") or {}).get(line.get("speaker") or "A") or ""
    voice = voice_by_id(voice_id) if voice_id else None
    if not voice:
        voices = load_voices()
        voice = voices[0] if voices else None
    path = voice_path(voice) if voice else None
    return path, voice or {}


def render_lines(name: str, indices: Optional[list[int]], progress: Progress) -> dict[str, Any]:
    cfg = load_show(name)
    settings = cfg.get("settings") or {}
    engine = cfg.get("engine") or "chatterbox"
    targets = [
        ln
        for ln in cfg.get("lines") or []
        if indices is None or ln["index"] in set(indices)
    ]
    if not targets:
        raise ValueError("No lines to render")
    total = len(targets)
    for i, line in enumerate(targets):
        progress((i / total) * 0.98, f"Line {line['index']} / {targets[-1]['index']}")
        prompt, voice = resolve_line_voice(cfg, line)
        if engine != "macos" and not prompt:
            raise ValueError("Add a voice sample before rendering with Chatterbox")
        wav, sr, qc, retries = generate_with_qc(
            engine=engine,
            text=line["text"],
            prompt_path=prompt,
            exaggeration=float(line.get("exaggeration") or voice.get("exaggeration") or 0.5),
            cfg_weight=float(line.get("cfg_weight") or voice.get("cfg_weight") or 0.5),
            temperature=float(line.get("temperature") or voice.get("temperature") or 0.8),
            to_48k=bool(settings.get("to_48k", True)),
            lufs_target=float(settings.get("lufs") or LUFS_TARGET),
            validate=bool(settings.get("qc", True)),
            max_retries=int(settings.get("retries") or 2),
        )
        out = line_wav(cfg, line["index"])
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), wav, sr)
        line["qc"] = qc.summary
        line["retries"] = retries
        line["duration"] = qc.duration_seconds
    save_show(cfg)
    progress(1.0, "Done")
    return show_detail(name)


def concat_show(name: str, progress: Progress) -> dict[str, Any]:
    cfg = load_show(name)
    settings = cfg.get("settings") or {}
    files = [line_wav(cfg, ln["index"]) for ln in cfg.get("lines") or []]
    files = [path for path in files if path.exists()]
    if not files:
        raise ValueError("Render lines before concat")
    progress(0.2, "Concatenating")
    mix = SHOWS_DIR / cfg["name"] / "mix.wav"
    concat_paths(
        files,
        mix,
        gap_seconds=float(settings.get("gap") or 0.35),
        target_sr=TARGET_SR if settings.get("to_48k", True) else 24000,
        lufs_target=float(settings.get("lufs") or LUFS_TARGET),
        crossfade_ms=float(settings.get("crossfade_ms") or 0),
    )
    cfg["mix"] = "mix.wav"
    save_show(cfg)
    progress(1.0, "Mix ready")
    return show_detail(name)


def effect_take(name: str, index: int, params: dict[str, float], progress: Progress) -> dict[str, Any]:
    cfg = load_show(name)
    src = line_wav(cfg, index)
    if not src.exists():
        raise FileNotFoundError(f"Line {index} has no audio")
    progress(0.2, "Applying effects")
    dest = SHOWS_DIR / cfg["name"] / "lines" / f"{index:03d}-fx.wav"
    process_file(
        src,
        dest,
        gain_db=float(params.get("gain_db") or 0),
        pitch_semitones=float(params.get("pitch_semitones") or 0),
        highpass_hz=float(params.get("highpass_hz") or 0),
        lowpass_hz=float(params.get("lowpass_hz") or 0),
        reverb=float(params.get("reverb") or 0),
    )
    # Replace the line take with the effected version so concat picks it up.
    shutil.copy2(dest, src)
    progress(1.0, "Effects applied")
    return show_detail(name)


def health() -> dict[str, Any]:
    ensure_dirs()
    return {
        "ok": True,
        "app": "612 Voice",
        "version": "1.0.0",
        "device": device_name(),
        "chatterbox": chatterbox_available(),
        "macos_say": macos_say_available(),
        "voices": len(load_voices()),
        "shows": len(list_shows()),
    }
