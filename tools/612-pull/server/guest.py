"""Password-gated pulls for friends.

The download happens on this machine; the finished file is handed back over HTTP so a
phone can drop it into Files/Photos and a laptop can just save it.
"""

from __future__ import annotations

import hmac
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import engine
from . import media as media_engine

ROOT = Path(__file__).resolve().parent.parent
GUEST_ROOT = ROOT / "guest-tmp"
PASSWORD = (os.environ.get("GROKPULL_PASSWORD") or "").strip()
TOKEN_TTL = 60 * 60 * 24 * 7
KEEP_FILES_FOR = 60 * 60 * 3
MAX_JOBS = 60
# The password is short and the page lives in a public repo, so cap guessing.
MAX_TRIES = 8
MAX_TRIES_TOTAL = 30
LOCKOUT = 60 * 15

router = APIRouter(prefix="/api/guest", tags=["guest"])

_sessions: dict[str, float] = {}
_failures: dict[str, list[float]] = {}
_all_failures: list[float] = []
_jobs: dict[str, dict[str, Any]] = {}
_order: list[str] = []
_queue: list[str] = []
_lock = threading.Lock()
_busy = False

AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".opus", ".ogg", ".flac", ".mka"}
PHONE_VCODEC = {"h264", "avc1"}
PHONE_ACODEC = {"aac", "mp3"}
DONE_STATES = {"done", "error", "expired"}

# yt-dlp's own wording is accurate but reads like a stack trace on a phone.
FRIENDLY_ERRORS = [
    ("sign in to confirm your age", "That video is age-restricted, so it can't be pulled."),
    ("age-restricted", "That video is age-restricted, so it can't be pulled."),
    ("not a bot", "The site wants a signed-in browser for that one. Try a different link."),
    ("account is private", "That account is private, so its posts can't be pulled."),
    ("private video", "That video is private."),
    ("is private", "That post is private, so it can't be pulled."),
    ("video unavailable", "That video isn't there any more."),
    ("has been removed", "That post has been taken down."),
    ("ip address is blocked", "The site blocked this machine from that post."),
    ("login required", "That post needs a login, so it can't be pulled."),
    ("requested format is not available", "Couldn't find a stream to download for that link."),
    ("unsupported url", "That link isn't a video page this can pull."),
    ("unable to extract", "That page didn't hand over a video. Check the link."),
    ("no video could be found", "No video on that page."),
    ("not available in your country", "That video is blocked in this region."),
    ("http error 403", "The site refused the download. Try again in a bit."),
    ("http error 404", "That link is dead."),
    ("unable to download webpage", "Couldn't open that page. Check the link."),
]


class LoginIn(BaseModel):
    password: str = ""


class PullIn(BaseModel):
    url: str = ""
    mode: str = "video"
    quality: str = "1080p"


def _purge_sessions() -> None:
    now = time.time()
    for token in [t for t, exp in _sessions.items() if exp < now]:
        _sessions.pop(token, None)


def _bearer(authorization: Optional[str], token: Optional[str]) -> str:
    _purge_sessions()
    raw = ""
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization.split(" ", 1)[1].strip()
    elif token:
        raw = token.strip()
    if not raw or raw not in _sessions:
        raise HTTPException(401, "Enter the password again.")
    return raw


def _public(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "status": job["status"],
        "percent": int(job.get("percent") or 0),
        "title": job.get("title") or "",
        "error": job.get("error") or "",
        "mode": job.get("mode") or "video",
        "filename": job.get("serve_name") or "",
        "size": job.get("size") or 0,
        "ready": job["status"] == "done" and bool(job.get("serve_path")),
    }


def _largest_media(folder: Path) -> Optional[Path]:
    found: list[Path] = []
    if not folder.exists():
        return None
    for root, _dirs, names in os.walk(folder):
        for name in names:
            path = Path(root) / name
            if path.suffix.lower() in media_engine.MEDIA_EXT:
                found.append(path)
    if not found:
        return None
    return max(found, key=lambda item: item.stat().st_size)


def _to_phone_audio(path: Path) -> tuple[Path, str]:
    suffix = path.suffix.lower()
    if suffix == ".mp3":
        return path, "audio/mpeg"
    if suffix in {".m4a", ".aac"}:
        return path, "audio/mp4"
    dest = path.with_name(f"{path.stem}.phone.m4a")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(path),
        "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        "-movflags", "+faststart",
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0 or not dest.is_file():
        raise RuntimeError("Could not convert that audio for a phone.")
    return dest, "audio/mp4"


def pack_for_phone(path: Path, mode: str) -> tuple[Path, str]:
    """Return a file iOS and QuickTime will open, converting only when necessary."""
    if mode == "audio" or path.suffix.lower() in AUDIO_EXT:
        return _to_phone_audio(path)
    try:
        info = media_engine.probe(str(path))
        # probe() also blesses HEVC, which older Macs and Android won't touch, so hold
        # this path to the H.264 + AAC the page promises.
        if (
            (info.get("container") or "") in {"mp4", "m4v", "mov"}
            and (info.get("vcodec") or "") in PHONE_VCODEC
            and (info.get("acodec") or "aac") in PHONE_ACODEC
        ):
            return path, "video/mp4"
    except Exception:
        pass
    packed = media_engine.export_quicktime(str(path))
    return Path(packed["path"]), "video/mp4"


def _guest_settings(mode: str, quality: str, folder: Path) -> dict[str, Any]:
    folder.mkdir(parents=True, exist_ok=True)
    return {
        "video_folder": str(folder),
        "music_folder": str(folder),
        "mode": mode,
        "quality": quality,
        "audio_quality": "192kbps",
        "container": "MP4",
        "device_safe": True,
        "playlist": False,
        "subtitles": False,
        "sponsorblock": "off",
        "auto_open": False,
        "cookies_browser": "None",
        "cookie_file": "",
    }


def _sweep() -> None:
    cutoff = time.time() - KEEP_FILES_FOR
    if not GUEST_ROOT.exists():
        return
    for child in GUEST_ROOT.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
                job = _jobs.get(child.name)
                if job:
                    job["serve_path"] = ""
                    if job.get("status") == "done":
                        job["status"] = "expired"
        except Exception:
            pass


def _expire_if_gone(job: dict[str, Any]) -> None:
    """_sweep only runs when a new pull starts, so re-check on every read as well."""
    if job.get("status") == "done" and not Path(job.get("serve_path") or ".").is_file():
        job["serve_path"] = ""
        job["status"] = "expired"


@router.get("/status")
def guest_status() -> dict[str, Any]:
    tools = engine.which_tools()
    ready = bool(tools.get("ffmpeg") and tools.get("ffprobe") and tools.get("ytdlp") != "?")
    return {"ok": True, "ready": ready, "ytdlp": tools.get("ytdlp"),
            "guest_only": os.environ.get("GROKPULL_GUEST_ONLY") == "1",
            "pot": bool(tools.get("pot")), "youtube": ready and bool(tools.get("pot") and tools.get("node"))}


def _caller(request: Request) -> str:
    """Through a tunnel every request looks local, so prefer the forwarded address."""
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
def guest_login(body: LoginIn, request: Request) -> dict[str, Any]:
    global _all_failures
    who = _caller(request)
    now = time.time()

    recent = [t for t in _failures.get(who, []) if now - t < LOCKOUT]
    _failures[who] = recent
    # A forwarded address can be faked, so a shared ceiling backs up the per-caller one.
    _all_failures = [t for t in _all_failures if now - t < LOCKOUT]
    if len(recent) >= MAX_TRIES or len(_all_failures) >= MAX_TRIES_TOTAL:
        raise HTTPException(429, "Too many tries. Wait a few minutes.")

    guess = (body.password or "").strip().strip("'\u2018\u2019\"\u201c\u201d")
    # Compare as bytes: compare_digest rejects non-ASCII str, and a phone keyboard hands
    # over curly quotes and accents readily.
    if not PASSWORD or not hmac.compare_digest(guess.encode("utf-8"), PASSWORD.encode("utf-8")):
        recent.append(now)
        _all_failures.append(now)
        time.sleep(0.5)
        raise HTTPException(403, "Wrong password.")

    _failures.pop(who, None)
    token = secrets.token_urlsafe(24)
    _sessions[token] = now + TOKEN_TTL
    return {"token": token, "expires_in": TOKEN_TTL}


@router.post("/pull")
def guest_pull(
    body: PullIn,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
) -> dict[str, Any]:
    _bearer(authorization, token)
    urls = engine.extract_urls(body.url)
    if not urls:
        raise HTTPException(400, "Paste a full link, like https://www.tiktok.com/...")
    url = urls[0]
    if engine.is_drm_url(url):
        raise HTTPException(400, "That site is DRM protected, so it can't be pulled.")
    mode = "audio" if body.mode == "audio" else "video"
    quality = body.quality if body.quality in {"1080p", "720p", "480p"} else "1080p"
    job_id = uuid.uuid4().hex[:10]
    folder = GUEST_ROOT / job_id
    platform = engine.detect_platform(url)
    job: dict[str, Any] = {
        "id": job_id,
        "url": engine.youtube_strip_playlist(engine.canonicalize_youtube_url(url)),
        "mode": mode,
        "status": "queued",
        "percent": 2,
        "title": platform.get("name") or "Link",
        "error": "",
        "folder": str(folder),
        "serve_path": "",
        "serve_name": "",
        "mime": "",
        "size": 0,
        "settings": _guest_settings(mode, quality, folder),
    }
    with _lock:
        _jobs[job_id] = job
        _order.append(job_id)
        _queue.append(job_id)
        while len(_order) > MAX_JOBS:
            # Only finished jobs may be evicted; dropping a queued or running one would
            # delete the folder out from under the worker.
            old = next((i for i in _order if (_jobs.get(i) or {}).get("status") in DONE_STATES), None)
            if old is None:
                break
            _order.remove(old)
            dead = _jobs.pop(old, None)
            if dead:
                shutil.rmtree(Path(dead["folder"]), ignore_errors=True)
    _start_worker()
    return _public(job)


@router.get("/job/{job_id}")
def guest_job(
    job_id: str,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
) -> dict[str, Any]:
    _bearer(authorization, token)
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "That pull is gone. Start it again.")
    _expire_if_gone(job)
    return _public(job)


@router.get("/file/{job_id}")
def guest_file(
    job_id: str,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
):
    _bearer(authorization, token)
    job = _jobs.get(job_id)
    if not job or job.get("status") != "done" or not job.get("serve_path"):
        raise HTTPException(404, "The file isn't ready yet.")
    path = Path(job["serve_path"])
    if not path.is_file():
        _expire_if_gone(job)
        raise HTTPException(404, "The file was cleaned up. Pull it again.")
    # FileResponse writes Content-Disposition itself; spelling it out here would send raw
    # non-ASCII bytes in the header and fail on any title with an emoji.
    return FileResponse(
        path,
        filename=job.get("serve_name") or path.name,
        media_type=job.get("mime") or "application/octet-stream",
    )


def _start_worker() -> None:
    global _busy
    with _lock:
        if _busy or not _queue:
            return
        _busy = True
    threading.Thread(target=_worker, daemon=True).start()


def _worker() -> None:
    global _busy
    try:
        while True:
            with _lock:
                if not _queue:
                    return
                job_id = _queue.pop(0)
            job = _jobs.get(job_id)
            if not job:
                continue
            _sweep()
            _run_job(job)
    finally:
        with _lock:
            _busy = False
        # Anything that slipped past _run_job would otherwise strand the rest of the
        # queue, and a pull that arrived while this thread was winding down saw _busy.
        _start_worker()


def _friendly(exc: Exception) -> str:
    raw = str(exc).strip()
    low = raw.lower()
    for needle, text in FRIENDLY_ERRORS:
        if needle in low:
            return text
    # Strip yt-dlp's "ERROR: [extractor] id:" prefix, which means nothing to whoever
    # pasted the link.
    cleaned = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*[^:]*:\s*)?", "", raw).strip()
    cleaned = cleaned.split(" (caused by ")[0].strip()
    return cleaned[:200] or "That link could not be pulled."


def _run_job(job: dict[str, Any]) -> None:
    job["status"] = "downloading"
    job["percent"] = 4

    def on_progress(payload: dict[str, Any]) -> None:
        pct = payload.get("percent") or 0
        job["percent"] = max(4, min(88, int(pct * 0.88)))
        name = payload.get("filename") or ""
        if name:
            job["title"] = Path(name).stem

    try:
        try:
            result = engine.download(job["url"], job["settings"], on_progress, lambda: False)
        except Exception:
            # H.264 isn't always downloadable (YouTube gates some rungs), and sites that
            # only publish muxed streams (TikTok) leave an audio pull with nothing to
            # select. Grab whatever stream exists and let pack_for_phone sort it out.
            relaxed = dict(job["settings"])
            relaxed["mode"] = "video"
            relaxed["device_safe"] = False
            relaxed["container"] = "Auto"
            shutil.rmtree(Path(job["folder"]), ignore_errors=True)
            Path(job["folder"]).mkdir(parents=True, exist_ok=True)
            result = engine.download(job["url"], relaxed, on_progress, lambda: False)
        folder = Path(job["folder"])
        source = Path(result["path"]) if result.get("path") else None
        if not source or not source.is_file():
            source = _largest_media(folder)
        if not source:
            raise RuntimeError("The download finished but no media file appeared.")

        job["status"] = "converting"
        job["percent"] = 90
        packed, mime = pack_for_phone(source, job["mode"])

        title = result.get("title") or job.get("title") or packed.stem
        name = f"{engine.safe_component(title)[:80]}{packed.suffix.lower()}"
        job["serve_path"] = str(packed)
        job["serve_name"] = name
        job["mime"] = mime
        job["size"] = packed.stat().st_size
        job["title"] = Path(name).stem
        job["percent"] = 100
        job["status"] = "done"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = _friendly(exc)
