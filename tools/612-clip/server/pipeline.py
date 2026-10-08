"""Project files, probe / transcribe / export jobs."""

from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from server.config import (
    APP_VERSION,
    CAPTION_PROFILES,
    DEFAULT_SETTINGS,
    GROKPULL_DOWNLOADS,
    PROJECTS_DIR,
    SUPPORTED,
    WHISPER_MODELS,
)
from server.engine.clips import (
    clip_filename,
    clip_to_range,
    clips_to_ranges,
    find_clip,
    kept_clips,
    load_clips,
    next_clip_id,
    normalize_clip,
)
from server.engine.export import (
    export_bundle,
    export_one,
    grokedit_running,
    grokedit_url,
    open_url,
    write_caption_sidecars,
)
from server.engine.ffmpeg import has_videotoolbox, probe, which_ffmpeg
from server.engine.probe import run_probe
from server.engine.pull import ytdlp_available
from server.engine.reframe import sample_faces
from server.engine.suggest import (
    silence_islands_from_audio,
    silence_islands_from_transcript,
    suggest_hooks,
)
from server.engine.transcript import build_ranges, kept_stats
from server.engine.window import as_range
from server.engine.whisper import device_name, transcribe, whisper_available

ProgressFn = Callable[[float, str], None]
StopFn = Callable[[], bool]
HOME = Path.home().resolve()
LOGO_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
# 612 Pull Watch slices: "Title.0s-3s.mkv", "Title.1m12s-3m50s.mkv"
SLICE_NAME = re.compile(
    r"\.(?:\d+h)?(?:\d+m)?\d+s-(?:\d+h)?(?:\d+m)?\d+s\.[^.]+$",
    re.IGNORECASE,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_slug(raw: str) -> str:
    stem = Path(raw).stem
    cleaned = re.sub(r"[^\w\s-]", "", stem, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", "_", cleaned).strip("_")
    return (cleaned[:80] or "untitled").lower()


def unique_slug(name: str) -> str:
    base = safe_slug(name)
    candidate = base
    n = 2
    while (PROJECTS_DIR / candidate).exists():
        candidate = f"{base}_{n}"
        n += 1
    return candidate


def project_dir(slug: str) -> Path:
    path = PROJECTS_DIR / slug
    if not path.exists():
        raise FileNotFoundError(slug)
    return path


def load_project(slug: str) -> dict[str, Any]:
    path = project_dir(slug) / "project.json"
    return json.loads(path.read_text(encoding="utf-8"))


def save_project(slug: str, data: dict[str, Any]) -> dict[str, Any]:
    dest = PROJECTS_DIR / slug
    dest.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = _now()
    (dest / "project.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def source_path(slug: str, data: Optional[dict[str, Any]] = None) -> Path:
    data = data or load_project(slug)
    rel = data.get("source") or "source.mp4"
    path = project_dir(slug) / rel
    if not path.exists():
        hits = [
            p
            for p in project_dir(slug).iterdir()
            if p.is_file() and p.suffix.lower() in SUPPORTED
        ]
        if not hits:
            raise FileNotFoundError("No source video")
        return hits[0]
    return path


def under_home(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if resolved != HOME and HOME not in resolved.parents:
        raise ValueError("Path must be inside your home folder")
    return resolved


def _clip_stats(data: dict[str, Any]) -> dict[str, Any]:
    duration = float((data.get("probe") or {}).get("duration") or 0)
    clips = load_clips(data, duration)
    kept = kept_clips(clips)
    return {
        "clips": clips,
        "clip_count": len(clips),
        "kept_clips": len(kept),
        "clip_duration": round(sum(c["end"] - c["start"] for c in kept), 3),
    }


def _store_clips(data: dict[str, Any], clips: list[dict[str, Any]]) -> None:
    data["clips"] = sorted(clips, key=lambda c: (c["start"], c["end"], c["id"]))


def summary(slug: str, data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    data = data or load_project(slug)
    probe = data.get("probe") or {}
    transcript = data.get("transcript") or {}
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    stats = kept_stats(transcript, settings) if transcript.get("segments") else {
        "lines": 0,
        "kept_lines": 0,
        "ranges": 0,
        "kept_duration": 0.0,
        "source_span": 0.0,
    }
    clip_info = _clip_stats(data)
    if clip_info["clip_count"]:
        stats["ranges"] = clip_info["kept_clips"]
        stats["kept_duration"] = clip_info["clip_duration"]
        if clip_info["kept_clips"]:
            kept = kept_clips(clip_info["clips"])
            stats["source_span"] = round(kept[-1]["end"] - kept[0]["start"], 3)
    return {
        "slug": slug,
        "name": data.get("name") or slug,
        "status": data.get("status") or "new",
        "duration": probe.get("duration"),
        "width": probe.get("width"),
        "height": probe.get("height"),
        "codec": probe.get("codec"),
        "has_audio": probe.get("has_audio"),
        "peaks": data.get("peaks") or [],
        "poster": "poster.jpg" if (PROJECTS_DIR / slug / "poster.jpg").exists() else None,
        "created_at": data.get("created_at"),
        "bundle": data.get("bundle"),
        "window": as_range(data.get("window")),
        "clip_count": clip_info["clip_count"],
        "kept_clips": clip_info["kept_clips"],
        **stats,
    }


def detail(slug: str) -> dict[str, Any]:
    data = load_project(slug)
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    transcript = data.get("transcript") or {"segments": []}
    duration = float((data.get("probe") or {}).get("duration") or 0)
    clips = load_clips(data, duration)
    if clips:
        ranges = clips_to_ranges(clips)
    else:
        ranges = build_ranges(transcript, settings) if transcript.get("segments") else []
    return {
        **summary(slug, data),
        "settings": settings,
        "probe": data.get("probe") or {},
        "transcript": transcript,
        "ranges": ranges,
        "clips": clips,
        "original_path": data.get("original_path"),
        "source": data.get("source"),
        "youtube": (data.get("bundle") or {}).get("meta"),
        "window": as_range(data.get("window")),
    }


def list_project_summaries() -> list[dict[str, Any]]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in PROJECTS_DIR.iterdir():
        if path.is_dir() and (path / "project.json").exists():
            try:
                rows.append(summary(path.name))
            except Exception:
                continue
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return rows


def list_pulls(limit: int = 200) -> list[dict[str, Any]]:
    if not GROKPULL_DOWNLOADS.exists():
        return []
    files = [
        p
        for p in GROKPULL_DOWNLOADS.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SUPPORTED
        and not SLICE_NAME.search(p.name)
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    rows = []
    for path in files[:limit]:
        stat = path.stat()
        rows.append(
            {
                "path": str(path),
                "name": path.name,
                "size": stat.st_size,
                "duration": None,
                "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return rows


def create_from_file(src: Path, name: str = "", *, require_home: bool = True) -> dict[str, Any]:
    src = src.expanduser().resolve()
    if require_home:
        src = under_home(src)
    if not src.is_file():
        raise FileNotFoundError(str(src))
    if src.suffix.lower() not in SUPPORTED:
        raise ValueError(f"Unsupported format {src.suffix}")
    slug = unique_slug(name or src.stem)
    dest = PROJECTS_DIR / slug
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"source{src.suffix.lower()}"
    shutil.copy2(src, target)
    data = {
        "slug": slug,
        "name": name or src.stem,
        "source": target.name,
        "original_path": str(src),
        "created_at": _now(),
        "status": "imported",
        "settings": dict(DEFAULT_SETTINGS),
        "probe": {},
        "peaks": [],
        "transcript": {"segments": []},
        "clips": [],
        "faces": [],
        "bundle": None,
    }
    save_project(slug, data)
    return summary(slug, data)


def delete_project(slug: str) -> None:
    shutil.rmtree(project_dir(slug), ignore_errors=True)


def patch_project(slug: str, *, name: Optional[str] = None, settings: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    data = load_project(slug)
    if name:
        data["name"] = name
    if settings:
        current = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
        profile = settings.get("caption_profile")
        if profile in CAPTION_PROFILES:
            current.update(CAPTION_PROFILES[profile])
        for key, value in settings.items():
            if key == "model" and value not in WHISPER_MODELS:
                continue
            current[key] = value
        data["settings"] = current
    save_project(slug, data)
    return detail(slug)


def save_logo(slug: str, src: Path) -> dict[str, Any]:
    src = src.expanduser().resolve()
    if not src.is_file():
        raise FileNotFoundError(str(src))
    suffix = src.suffix.lower()
    if suffix not in LOGO_EXT:
        raise ValueError("Logo must be a PNG, JPG, WebP, or GIF")
    dest_dir = project_dir(slug)
    for old in dest_dir.glob("logo.*"):
        old.unlink(missing_ok=True)
    dest = dest_dir / f"logo{suffix}"
    shutil.copy2(src, dest)
    return patch_project(slug, settings={"logo": dest.name})


def clear_logo(slug: str) -> dict[str, Any]:
    dest_dir = project_dir(slug)
    for old in dest_dir.glob("logo.*"):
        old.unlink(missing_ok=True)
    return patch_project(slug, settings={"logo": ""})


def set_window(slug: str, window: Optional[dict[str, Any]]) -> dict[str, Any]:
    data = load_project(slug)
    data["window"] = window
    save_project(slug, data)
    return detail(slug)


def set_kept(slug: str, ids: list[int], kept: bool) -> dict[str, Any]:
    data = load_project(slug)
    wanted = set(ids)
    for seg in data.get("transcript", {}).get("segments", []):
        if int(seg.get("id")) in wanted:
            seg["kept"] = bool(kept)
    save_project(slug, data)
    return detail(slug)


def set_kept_all(slug: str, kept: bool) -> dict[str, Any]:
    data = load_project(slug)
    for seg in data.get("transcript", {}).get("segments", []):
        seg["kept"] = bool(kept)
    save_project(slug, data)
    return detail(slug)


def add_clip(
    slug: str,
    start: float,
    end: float,
    label: str = "",
    kept: bool = True,
    kind: str = "talk",
) -> dict[str, Any]:
    data = load_project(slug)
    duration = float((data.get("probe") or {}).get("duration") or 0)
    clips = load_clips(data, duration)
    cid = next_clip_id(clips)
    clip = normalize_clip(
        {"id": cid, "start": start, "end": end, "label": label, "kept": kept, "kind": kind},
        duration=duration,
        clip_id=cid,
    )
    if not str(label or "").strip():
        clip["label"] = f"Clip {len(clips) + 1}"
        clip["text"] = clip["label"]
    clips.append(clip)
    _store_clips(data, clips)
    save_project(slug, data)
    return detail(slug)


def patch_clip(slug: str, clip_id: int, fields: dict[str, Any]) -> dict[str, Any]:
    data = load_project(slug)
    duration = float((data.get("probe") or {}).get("duration") or 0)
    clips = load_clips(data, duration)
    clip = find_clip(clips, clip_id)
    if not clip:
        raise FileNotFoundError("Clip not found")
    merged = dict(clip)
    for key in ("start", "end", "label", "kept", "text", "kind"):
        if key in fields and fields[key] is not None:
            merged[key] = fields[key]
    updated = normalize_clip(merged, duration=duration, clip_id=clip_id)
    clips = [updated if c["id"] == clip_id else c for c in clips]
    _store_clips(data, clips)
    save_project(slug, data)
    return detail(slug)


def delete_clip(slug: str, clip_id: int) -> dict[str, Any]:
    data = load_project(slug)
    duration = float((data.get("probe") or {}).get("duration") or 0)
    clips = [c for c in load_clips(data, duration) if c["id"] != clip_id]
    _store_clips(data, clips)
    save_project(slug, data)
    return detail(slug)


def set_clip_kept(slug: str, ids: list[int], kept: bool) -> dict[str, Any]:
    data = load_project(slug)
    duration = float((data.get("probe") or {}).get("duration") or 0)
    wanted = set(int(i) for i in ids)
    clips = load_clips(data, duration)
    for clip in clips:
        if clip["id"] in wanted:
            clip["kept"] = bool(kept)
    _store_clips(data, clips)
    save_project(slug, data)
    return detail(slug)


def export_clip(slug: str, clip_id: int, progress: ProgressFn) -> dict[str, Any]:
    data = load_project(slug)
    src = source_path(slug, data)
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    probe_info = data.get("probe") or {}
    faces = data.get("faces") or []
    duration = float(probe_info.get("duration") or 0)
    clip = find_clip(load_clips(data, duration), clip_id)
    if not clip:
        raise FileNotFoundError("Clip not found")

    def face_progress(value: float, step: str) -> None:
        progress(0.02 + 0.18 * value, step)

    if not faces and duration > 0 and str(settings.get("layout") or "blur") == "crop":
        progress(0.02, "Tracking faces")
        faces = sample_faces(src, duration, progress=face_progress)
        data["faces"] = faces
        save_project(slug, data)

    dest = project_dir(slug) / "bundle" / "clips" / clip_filename(clip)

    def export_progress(value: float, step: str) -> None:
        progress(0.22 + 0.78 * value, step)

    result = export_one(
        src,
        dest,
        clip_to_range(clip),
        settings=settings,
        probe=probe_info,
        faces=faces,
        progress=export_progress,
        transcript=data.get("transcript") or {},
        clip=clip,
    )
    rel = f"bundle/clips/{dest.name}"
    bundle = dict(data.get("bundle") or {})
    files = [p for p in (bundle.get("clip_files") or []) if p != rel]
    files.append(rel)
    bundle["clip_files"] = files
    data["bundle"] = bundle
    save_project(slug, data)
    out = summary(slug, data)
    out["last_export"] = {
        "path": rel,
        "filename": str(dest),
        "folder": str(dest.parent),
        "captioned": bool(result.get("captioned")),
        "kind": clip.get("kind") or "talk",
    }
    return out


def export_kept_clips(slug: str, progress: ProgressFn) -> dict[str, Any]:
    data = load_project(slug)
    duration = float((data.get("probe") or {}).get("duration") or 0)
    kept = kept_clips(load_clips(data, duration))
    if not kept:
        raise RuntimeError("Keep at least one clip first")
    n = len(kept)
    last: dict[str, Any] = {}
    captioned = 0
    skipped = 0
    for i, clip in enumerate(kept):
        def clip_progress(value: float, step: str, *, index=i) -> None:
            span = 1.0 / n
            progress(index * span + span * value, f"{clip.get('label') or 'Clip'} · {step}")

        last = export_clip(slug, int(clip["id"]), clip_progress)
        info = last.get("last_export") or {}
        if info.get("captioned"):
            captioned += 1
        else:
            skipped += 1
    last["last_export"] = {
        **(last.get("last_export") or {}),
        "count": n,
        "captioned": captioned,
        "skipped_captions": skipped,
    }
    return last


def suggest_clips(
    slug: str,
    progress: ProgressFn,
    *,
    mode: str = "hooks",
    target_s: float = 30.0,
    replace: bool = False,
) -> dict[str, Any]:
    """Propose hook windows and/or silence-stripped speech islands into the clip bin."""
    data = load_project(slug)
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    probe_info = data.get("probe") or {}
    duration = float(probe_info.get("duration") or 0)
    transcript = data.get("transcript") or {}
    peaks = list(data.get("peaks") or [])
    mode = str(mode or "hooks")
    if mode not in ("hooks", "silence", "both"):
        raise ValueError("mode must be hooks, silence, or both")

    proposed: list[dict[str, Any]] = []
    if mode in ("hooks", "both"):
        progress(0.1, "Scoring hooks")
        segs = (transcript.get("segments") or [])
        if not segs:
            raise RuntimeError("Transcribe first to suggest hooks")
        proposed.extend(
            suggest_hooks(
                transcript,
                peaks=peaks,
                duration=duration,
                target_s=float(target_s or 30),
                top_n=5,
            )
        )
    if mode in ("silence", "both"):
        progress(0.45, "Finding speech")
        islands: list[dict[str, Any]] = []
        if transcript.get("segments"):
            islands = silence_islands_from_transcript(
                transcript, settings=settings, duration=duration
            )
        if not islands:
            wav = project_dir(slug) / "speech.wav"
            audio = wav if wav.is_file() else source_path(slug, data)
            islands = silence_islands_from_audio(
                audio, duration=duration, settings=settings
            )
        if mode == "both":
            # Keep hooks; only add silence islands that don't overlap hooks heavily
            for island in islands:
                if any(
                    min(island["end"], h["end"]) - max(island["start"], h["start"])
                    > 0.6 * island["duration"]
                    for h in proposed
                ):
                    continue
                proposed.append(island)
        else:
            proposed = islands

    progress(0.8, f"Writing {len(proposed)} clips")
    existing = [] if replace else load_clips(data, duration)
    clips = list(existing)
    for row in proposed:
        cid = next_clip_id(clips)
        label = str(row.get("label") or f"Clip {cid}")
        clip = normalize_clip(
            {
                "id": cid,
                "start": row["start"],
                "end": row["end"],
                "label": label,
                "kept": True,
                "kind": row.get("kind") or "talk",
                "text": row.get("text") or label,
            },
            duration=duration,
            clip_id=cid,
        )
        clips.append(clip)
    _store_clips(data, clips)
    save_project(slug, data)
    progress(1.0, f"Added {len(proposed)} suggestions")
    out = detail(slug)
    out["suggested"] = len(proposed)
    return out


def write_captions(slug: str) -> dict[str, Any]:
    """Write SRT/ASS sidecars without encoding video."""
    data = load_project(slug)
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    probe_info = data.get("probe") or {}
    duration = float(probe_info.get("duration") or 0)
    transcript = data.get("transcript") or {}
    clips = load_clips(data, duration)
    if clips and kept_clips(clips):
        ranges = clips_to_ranges(kept_clips(clips))
    else:
        ranges = build_ranges(transcript, settings)
        win = as_range(data.get("window"))
        if win:
            from server.engine.window import clip_ranges

            ranges = clip_ranges(ranges, win)
    if not ranges:
        raise RuntimeError("Keep clips or transcript lines first")
    if not (transcript.get("segments") or []):
        raise RuntimeError("Transcribe first for captions")
    root = project_dir(slug) / "bundle"
    root.mkdir(parents=True, exist_ok=True)
    paths = write_caption_sidecars(
        root,
        transcript=transcript,
        settings=settings,
        probe=probe_info,
        ranges=ranges,
    )
    bundle = dict(data.get("bundle") or {})
    if paths.get("srt"):
        bundle["captions"] = "bundle/captions.srt"
    if paths.get("ass"):
        bundle["captions_ass"] = "bundle/captions.ass"
    data["bundle"] = bundle
    save_project(slug, data)
    out = detail(slug)
    out["captions"] = paths
    return out


def health() -> dict[str, Any]:
    ffmpeg_ok = True
    ffmpeg_path = None
    try:
        ffmpeg_path = which_ffmpeg()
    except Exception:
        ffmpeg_ok = False
    return {
        "ok": True,
        "app": "612 Clip",
        "version": APP_VERSION,
        "ffmpeg": ffmpeg_ok,
        "ffmpeg_path": ffmpeg_path,
        "videotoolbox": has_videotoolbox() if ffmpeg_ok else False,
        "whisper": whisper_available(),
        "device": device_name(),
        "models": list(WHISPER_MODELS),
        "formats": sorted(SUPPORTED),
        "grokedit": grokedit_running(),
        "pulls": GROKPULL_DOWNLOADS.exists(),
        "ytdlp": ytdlp_available(),
    }


def probe_project(slug: str, progress: ProgressFn) -> dict[str, Any]:
    data = load_project(slug)
    src = source_path(slug, data)
    info = run_probe(src, project_dir(slug), progress)
    peaks = info.pop("peaks", [])
    data["probe"] = info
    data["peaks"] = peaks
    data["status"] = "probed"
    save_project(slug, data)
    return summary(slug, data)


def transcribe_project(
    slug: str,
    progress: ProgressFn,
    stop: Optional[StopFn] = None,
    window: Optional[dict[str, Any]] = None,
    *,
    apply_stored_window: bool = True,
    scope: str = "all",
) -> dict[str, Any]:
    data = load_project(slug)
    src = source_path(slug, data)
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    model = settings.get("model") or "base"
    duration = float((data.get("probe") or {}).get("duration") or 0)
    stored = data.get("window") if apply_stored_window else None
    win = as_range(window if window is not None else stored)
    windows: list[dict[str, Any]] = []
    if scope == "kept":
        clips = kept_clips(load_clips(data, duration))
        if clips:
            windows = _merge_clip_windows(clips)
    if not windows:
        windows = [win] if win else [{"start": 0.0, "end": None}]

    segments: list[dict[str, Any]] = []
    language = "en"
    n = len(windows)
    for i, span in enumerate(windows):
        start = float(span.get("start") or 0)
        end = span.get("end")
        end_f = float(end) if end is not None else None

        def part_progress(value: float, step: str, *, index=i) -> None:
            base = index / max(n, 1)
            progress(base + value / max(n, 1), step if n == 1 else f"{step} · {index + 1}/{n}")

        part = transcribe(
            src,
            model_name=model,
            duration=duration,
            vad_filter=str(settings.get("vad_filter") or "auto"),
            wav_path=project_dir(slug) / (f"speech-{i}.wav" if n > 1 else "speech.wav"),
            progress=part_progress,
            stop=stop,
            start=start,
            end=end_f,
        )
        language = part.get("language") or language
        segments.extend(part.get("segments") or [])

    segments.sort(key=lambda s: float(s.get("start") or 0))
    for i, seg in enumerate(segments):
        seg["id"] = i
        seg["kept"] = True

    data["transcript"] = {
        "language": language,
        "model": model,
        "vad": "auto",
        "segments": segments,
        "scope": scope,
    }
    data["status"] = "transcribed"
    if window is not None:
        data["window"] = {"start": win["start"], "end": win["end"]} if win else None
    save_project(slug, data)
    return summary(slug, data)


def _merge_clip_windows(clips: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = sorted(clips, key=lambda c: float(c["start"]))
    out: list[dict[str, Any]] = []
    for clip in rows:
        start = float(clip["start"])
        end = float(clip["end"])
        if out and start <= float(out[-1]["end"]) + 0.3:
            out[-1]["end"] = max(float(out[-1]["end"]), end)
        else:
            out.append({"start": start, "end": end})
    return out


def patch_segment_text(slug: str, seg_id: int, text: str) -> dict[str, Any]:
    data = load_project(slug)
    segs = list((data.get("transcript") or {}).get("segments") or [])
    found = None
    for seg in segs:
        if int(seg.get("id")) == int(seg_id):
            found = seg
            break
    if not found:
        raise FileNotFoundError("Line not found")
    cleaned = " ".join(str(text or "").split())
    found["text"] = cleaned
    start = float(found.get("start") or 0)
    end = float(found.get("end") or start)
    tokens = cleaned.split() if cleaned else []
    old = list(found.get("words") or [])
    if not tokens:
        found["words"] = []
    elif len(old) == len(tokens):
        for word, token in zip(old, tokens):
            word["word"] = token
        found["words"] = old
    else:
        span = max(0.05, end - start)
        n = len(tokens)
        found["words"] = [
            {
                "word": token,
                "start": round(start + span * i / n, 3),
                "end": round(start + span * (i + 1) / n, 3),
            }
            for i, token in enumerate(tokens)
        ]
    data["transcript"] = {**(data.get("transcript") or {}), "segments": segs}
    save_project(slug, data)
    return detail(slug)


def export_project(
    slug: str,
    progress: ProgressFn,
    settings_override: Optional[dict[str, Any]] = None,
    window: Optional[dict[str, Any]] = None,
    *,
    apply_stored_window: bool = True,
) -> dict[str, Any]:
    data = load_project(slug)
    src = source_path(slug, data)
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {}), **(settings_override or {})}
    probe = data.get("probe") or {}
    faces = data.get("faces") or []
    duration = float(probe.get("duration") or 0)
    stored = data.get("window") if apply_stored_window else None
    win = as_range(window if window is not None else stored)

    def face_progress(value: float, step: str) -> None:
        progress(0.02 + 0.18 * value, step)

    if not faces and duration > 0 and str(settings.get("layout") or "blur") == "crop":
        progress(0.02, "Tracking faces")
        faces = sample_faces(src, duration, progress=face_progress)
        data["faces"] = faces
        save_project(slug, data)

    def export_progress(value: float, step: str) -> None:
        progress(0.22 + 0.78 * value, step)

    bundle = export_bundle(
        src,
        project_dir(slug) / "bundle",
        transcript=data.get("transcript") or {},
        settings=settings,
        probe=probe,
        faces=faces,
        source_name=data.get("name") or slug,
        progress=export_progress,
        window=win,
        clips=data.get("clips") or [],
    )
    data["bundle"] = bundle
    data["status"] = "exported"
    if settings_override:
        current = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
        for key, value in settings_override.items():
            if key == "model":
                continue
            current[key] = value
        data["settings"] = current
    if win:
        data["window"] = {"start": win["start"], "end": win["end"]}
    save_project(slug, data)
    return summary(slug, data)


def open_bundle(slug: str) -> None:
    dest = project_dir(slug) / "bundle"
    dest.mkdir(parents=True, exist_ok=True)
    reveal(dest)


def reveal(path: Path) -> None:
    import subprocess

    opener = "open" if os.uname().sysname == "Darwin" else "xdg-open"
    subprocess.Popen([opener, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def open_thumbnail_in_grokedit(slug: str) -> dict[str, Any]:
    data = load_project(slug)
    thumb = project_dir(slug) / "bundle" / "thumbnail.png"
    if not thumb.exists():
        raise FileNotFoundError("Export a bundle first")
    url = grokedit_url(thumb)
    opened = False
    if grokedit_running():
        open_url(url)
        opened = True
    else:
        reveal(thumb)
    return {"opened": opened, "edit_url": url, "path": str(thumb)}
