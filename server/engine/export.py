"""Cut kept ranges, fit to canvas, brand, captions, youtube.txt, thumbnail."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote

from server.config import GROKEDIT_URL
from server.engine import ffmpeg as ff
from server.engine.captions import escape_subtitles, force_style, group_karaoke, write_ass, write_srt
from server.engine.compose import brand, canvas_size, encode_fit
from server.engine.reframe import center_for_range
from server.engine.clips import clip_filename, clips_to_ranges, kept_clips, load_clips
from server.engine.transcript import build_ranges, remap_words
from server.engine.window import as_range, clip_ranges

ProgressFn = Callable[[float, str], None]


def _slug_words(text: str, n: int = 8) -> str:
    words = re.findall(r"[A-Za-z0-9']+", text)
    return " ".join(words[:n]).strip()


def youtube_pack(ranges: list[dict[str, Any]], words: list[dict[str, Any]], source_name: str) -> dict[str, str]:
    body = " ".join(r["text"] for r in ranges).strip()
    title = _slug_words(ranges[0]["text"] if ranges else source_name, 10) or source_name
    if len(title) > 70:
        title = title[:67].rstrip() + "…"
    freq: dict[str, int] = {}
    for word in words:
        token = re.sub(r"[^a-z0-9]+", "", word["word"].lower())
        if len(token) < 4:
            continue
        freq[token] = freq.get(token, 0) + 1
    tags = [w for w, _ in sorted(freq.items(), key=lambda kv: kv[1], reverse=True)[:12]]
    hashtags = ["#shorts", "#youtube"] + [f"#{t}" for t in tags[:6]]
    description = (
        f"{title}\n\n{body[:800]}\n\n"
        + " ".join(hashtags)
        + "\n\nCut locally with GrokClip. No upload."
    )
    return {
        "title": title,
        "description": description,
        "tags": ", ".join(tags),
        "hashtags": " ".join(hashtags),
        "thumbnail_text": _slug_words(title, 4).upper(),
    }


def write_youtube_txt(meta: dict[str, str], dest: Path) -> Path:
    dest.write_text(
        "\n".join(
            [
                "TITLE",
                "------",
                meta["title"],
                "",
                "DESCRIPTION",
                "------",
                meta["description"],
                "",
                "TAGS",
                "------",
                meta["tags"],
                "",
                "HASHTAGS",
                "------",
                meta["hashtags"],
                "",
                "THUMBNAIL TEXT",
                "------",
                meta["thumbnail_text"],
                "",
            ]
        ),
        encoding="utf-8",
    )
    return dest


def grokedit_url(image_path: Path) -> str:
    return f"{GROKEDIT_URL}/?image={quote(str(image_path))}"


def grokedit_running() -> bool:
    try:
        import urllib.request

        urllib.request.urlopen(GROKEDIT_URL + "/", timeout=0.4)
        return True
    except Exception:
        return False


def open_url(url: str) -> None:
    subprocess.Popen(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _concat(parts: list[Path], dest: Path) -> None:
    listing = dest.parent / "concat.txt"
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts), encoding="utf-8")
    ff.run(
        [
            ff.which_ffmpeg(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listing),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(dest),
        ],
        timeout=300,
    )


def _burn(
    src: Path,
    subs: Path,
    dest: Path,
    style: str,
    has_audio: bool,
    portrait: bool,
) -> None:
    escaped = escape_subtitles(subs)
    vf = f"subtitles='{escaped}'"
    if subs.suffix.lower() != ".ass":
        vf += f":force_style='{force_style(style)}'"
    ff.run(
        [
            ff.which_ffmpeg(),
            "-y",
            "-i",
            str(src),
            "-vf",
            vf,
            *ff.video_args(portrait=portrait),
            *ff.audio_args(has_audio),
            "-movflags",
            "+faststart",
            str(dest),
        ],
        timeout=900,
    )


def _encode_canvas(
    src: Path,
    dest: Path,
    ranges: list[dict[str, Any]],
    *,
    frame: str,
    settings: dict[str, Any],
    probe: dict[str, Any],
    faces: list[dict[str, Any]],
    work: Path,
    prefix: str,
    progress: Optional[ProgressFn],
    t0: float,
    t1: float,
) -> list[Path]:
    canvas = canvas_size(frame)
    width = int(probe.get("width") or 1920)
    height = int(probe.get("height") or 1080)
    has_audio = bool(probe.get("has_audio"))
    layout = str(settings.get("layout") or "blur")
    border = str(settings.get("border") or "none")
    border_color = str(settings.get("border_color") or "#c084fc")
    n = len(ranges)
    parts: list[Path] = []
    for i, rng in enumerate(ranges):
        if progress:
            span = t1 - t0
            progress(t0 + span * (i / max(n, 1)), f"{frame} cut {i + 1}/{n}")
        cx, cy = center_for_range(faces, rng["start"], rng["end"])
        part = work / f"{prefix}{i:03d}.mp4"
        encode_fit(
            src,
            part,
            rng["start"],
            rng["end"],
            canvas=canvas,
            layout=layout,
            src_w=width,
            src_h=height,
            cx=cx,
            cy=cy,
            border=border,
            border_color=border_color,
            has_audio=has_audio,
        )
        parts.append(part)
    plain = work / f"{prefix}_plain.mp4"
    if len(parts) == 1:
        shutil.copy2(parts[0], plain)
    else:
        _concat(parts, plain)

    branded = work / f"{prefix}_brand.mp4"
    logo_rel = str(settings.get("logo") or "")
    logo = (src.parent / logo_rel) if logo_rel else None
    brand(
        plain,
        branded,
        credit=str(settings.get("credit") or ""),
        credit_corner=str(settings.get("credit_corner") or "bl"),
        logo=logo if logo and logo.is_file() else None,
        has_audio=has_audio,
        canvas=canvas,
    )
    shutil.copy2(branded, dest)
    return parts


def export_one(
    src: Path,
    dest: Path,
    rng: dict[str, Any],
    *,
    settings: dict[str, Any],
    probe: dict[str, Any],
    faces: list[dict[str, Any]],
    progress: Optional[ProgressFn] = None,
) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent / f".work-{dest.stem}"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    try:
        _encode_canvas(
            src,
            dest,
            [rng],
            frame=str(settings.get("frame") or "9:16"),
            settings=settings,
            probe=probe,
            faces=faces,
            work=work,
            prefix="c",
            progress=progress,
            t0=0.0,
            t1=1.0,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return dest


def export_bundle(
    src: Path,
    dest_dir: Path,
    *,
    transcript: dict[str, Any],
    settings: dict[str, Any],
    probe: dict[str, Any],
    faces: list[dict[str, Any]],
    source_name: str,
    progress: Optional[ProgressFn] = None,
    window: Optional[dict[str, Any]] = None,
    clips: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    duration = float(probe.get("duration") or 0)
    bounds = as_range(window)
    raw_clips = load_clips({"clips": clips or []}, duration)
    kept = kept_clips(raw_clips)
    from_clips = bool(raw_clips)
    if from_clips and kept:
        ranges = clips_to_ranges(kept)
    else:
        from_clips = False
        ranges = build_ranges(transcript, settings)
        ranges = clip_ranges(ranges, bounds)
        if not ranges:
            if bounds:
                ranges = [bounds]
            elif duration > 0:
                ranges = [{"start": 0.0, "end": duration, "text": "", "duration": duration}]
            else:
                raise RuntimeError("Keep at least one clip or line, or probe a file first")
    dest_dir.mkdir(parents=True, exist_ok=True)
    work = dest_dir / "work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()

    has_audio = bool(probe.get("has_audio"))
    captions_on = bool(settings.get("captions", True))
    primary_frame = str(settings.get("frame") or "9:16")

    if progress:
        progress(0.04, f"Fit {primary_frame}")
    primary = dest_dir / "primary.mp4"
    primary_parts = _encode_canvas(
        src,
        primary,
        ranges,
        frame=primary_frame,
        settings=settings,
        probe=probe,
        faces=faces,
        work=work,
        prefix="p",
        progress=progress,
        t0=0.04,
        t1=0.55,
    )

    clip_files: list[str] = []
    if from_clips and primary_parts:
        if progress:
            progress(0.55, "Saving clips")
        clips_dir = dest_dir / "clips"
        clips_dir.mkdir(parents=True, exist_ok=True)
        canvas = canvas_size(primary_frame)
        has_audio = bool(probe.get("has_audio"))
        logo_rel = str(settings.get("logo") or "")
        logo = src.parent / logo_rel if logo_rel else None
        logo = logo if logo and logo.is_file() else None
        for i, (part, rng) in enumerate(zip(primary_parts, ranges)):
            name = clip_filename(
                {
                    "id": rng.get("id") or i + 1,
                    "label": rng.get("label") or rng.get("text") or f"Clip {i + 1}",
                }
            )
            branded = clips_dir / name
            brand(
                part,
                branded,
                credit=str(settings.get("credit") or ""),
                credit_corner=str(settings.get("credit_corner") or "bl"),
                logo=logo,
                has_audio=has_audio,
                canvas=canvas,
            )
            clip_files.append(f"bundle/clips/{name}")

    if progress:
        progress(0.56, "Landscape")
    landscape = dest_dir / "landscape.mp4"
    _encode_canvas(
        src,
        landscape,
        ranges,
        frame="16:9",
        settings=settings,
        probe=probe,
        faces=faces,
        work=work,
        prefix="l",
        progress=progress,
        t0=0.56,
        t1=0.78,
    )

    portrait = dest_dir / "portrait.mp4"
    if primary_frame == "9:16":
        shutil.copy2(primary, portrait)
    else:
        if progress:
            progress(0.8, "Portrait")
        _encode_canvas(
            src,
            portrait,
            ranges,
            frame="9:16",
            settings=settings,
            probe=probe,
            faces=faces,
            work=work,
            prefix="v",
            progress=progress,
            t0=0.8,
            t1=0.9,
        )

    words = remap_words(transcript, settings, ranges)
    max_words = max(1, min(6, int(settings.get("caption_words") or 4)))
    cues = group_karaoke(words, max_words=max_words)
    if bool(settings.get("caption_uppercase")):
        for cue in cues:
            cue["text"] = str(cue.get("text") or "").upper()
            for word in cue.get("words") or []:
                word["word"] = str(word.get("word") or "").upper()
    srt = write_srt(cues, dest_dir / "captions.srt")
    ass = write_ass(
        cues,
        dest_dir / "captions.ass",
        frame=primary_frame,
        layout=str(settings.get("layout") or "blur"),
        src_w=int(probe.get("width") or 1920),
        src_h=int(probe.get("height") or 1080),
        style=str(settings.get("caption_style") or "hook"),
        settings=settings,
    )
    if captions_on and cues:
        if progress:
            progress(0.92, "Burning captions")
        captioned = dest_dir / "primary_captioned.mp4"
        _burn(
            primary,
            ass,
            captioned,
            str(settings.get("caption_style") or "hook"),
            has_audio,
            portrait=canvas_size(primary_frame)[1] > canvas_size(primary_frame)[0],
        )
        shutil.move(str(captioned), str(primary))

    if progress:
        progress(0.95, "Thumbnail")
    thumb = dest_dir / "thumbnail.png"
    ff.grab_frame(primary, thumb, 0.2)

    meta = youtube_pack(ranges, words, source_name)
    write_youtube_txt(meta, dest_dir / "youtube.txt")
    shutil.rmtree(work, ignore_errors=True)

    if progress:
        progress(1.0, "Bundle ready")
    return {
        "primary": "bundle/primary.mp4",
        "portrait": "bundle/portrait.mp4",
        "landscape": "bundle/landscape.mp4",
        "captions": "bundle/captions.srt",
        "captions_ass": "bundle/captions.ass",
        "youtube": "bundle/youtube.txt",
        "thumbnail": "bundle/thumbnail.png",
        "frame": primary_frame,
        "meta": meta,
        "ranges": len(ranges),
        "duration": round(sum(r["end"] - r["start"] for r in ranges), 3),
        "edit_url": grokedit_url(thumb),
        "clip_files": clip_files,
        "from_clips": from_clips,
    }
