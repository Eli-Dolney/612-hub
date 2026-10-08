"""Local FastAPI server for 612 Pull."""

from __future__ import annotations

import asyncio
import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import engine
from . import guest as guest_api
from . import media as media_engine

ROOT = Path(__file__).resolve().parent.parent
CONFIG_ROOT = Path(os.environ.get("GROKPULL_CONFIG_DIR") or Path.home())
CONFIG_ROOT.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = CONFIG_ROOT / ".grokpull.json"
HISTORY_PATH = CONFIG_ROOT / ".grokpull-history.json"

DEFAULT_VIDEO = str(ROOT / "downloads")
DEFAULT_MUSIC = str(ROOT / "music")


def default_settings() -> dict[str, Any]:
    return {
        "video_folder": DEFAULT_VIDEO,
        "music_folder": DEFAULT_MUSIC,
        "mode": "video",
        "quality": "Best Available",
        "audio_quality": "Best (original)",
        "container": "Auto",
        "playlist": False,
        "subtitles": True,
        "sponsorblock": "off",
        "auto_open": False,
        "cookies_browser": "None",
        "cookie_file": "",
    }


def load_settings() -> dict[str, Any]:
    data = default_settings()
    try:
        loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data.update({k: v for k, v in loaded.items() if k in data})
    except Exception:
        pass
    os.makedirs(data["video_folder"], exist_ok=True)
    os.makedirs(data["music_folder"], exist_ok=True)
    return data


def save_settings(data: dict[str, Any]) -> dict[str, Any]:
    merged = load_settings()
    merged.update({k: v for k, v in data.items() if k in merged})
    CONFIG_PATH.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    os.makedirs(merged["video_folder"], exist_ok=True)
    os.makedirs(merged["music_folder"], exist_ok=True)
    return merged


def load_history() -> list[dict[str, Any]]:
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data[:120]
    except Exception:
        pass
    return []


def save_history(items: list[dict[str, Any]]) -> None:
    try:
        HISTORY_PATH.write_text(json.dumps(items[:120], indent=2), encoding="utf-8")
    except Exception:
        pass


ALLOWED_ORIGINS = [
    "http://127.0.0.1:5175",
    "http://localhost:5175",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
    # optional local guest frontend
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]
ALLOWED_ORIGINS += [
    o.strip() for o in (os.environ.get("GROKPULL_CORS") or "").split(",") if o.strip()
]

# Phones testing over Wi-Fi hit this by LAN address, which isn't a fixed origin.
LAN_ORIGIN_RE = (
    r"http://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?"
)

# Cloudflare Pages names every preview deployment after the commit that built it
# (https://b77ec724.eli-8fk.pages.dev), so previews can't be listed one at a time.
# Only labels in front of this one project match: the escaped dot rules out a lookalike
# project such as https://evil-eli-8fk.pages.dev, and the anchors below rule out
# https://b77ec724.eli-8fk.pages.dev.attacker.com. Other pages.dev projects are not
# allowed — anyone can deploy one.
PAGES_ORIGIN_RE = r"https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)*eli-8fk\.pages\.dev"

# Starlette compares with fullmatch(), but anchor the pattern anyway so it stays safe if
# it is ever reused somewhere that only calls match().
ALLOWED_ORIGIN_RE = rf"\A(?:{LAN_ORIGIN_RE}|{PAGES_ORIGIN_RE})\Z"

app = FastAPI(title="612 Pull")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_RE,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.include_router(guest_api.router)

# The studio has local filesystem controls and no login. Shared containers must
# never publish those routes, even to someone who knows the household PIN.
if os.environ.get("GROKPULL_GUEST_ONLY") == "1":
    @app.middleware("http")
    async def guest_only(request, call_next):
        if not request.url.path.startswith("/api/guest/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        return await call_next(request)


settings_lock = threading.Lock()
jobs: dict[str, dict[str, Any]] = {}
job_order: list[str] = []
queue: list[str] = []
subscribers: list[asyncio.Queue] = []
worker_busy = False
main_loop: Optional[asyncio.AbstractEventLoop] = None
history: list[dict[str, Any]] = load_history()


class SettingsIn(BaseModel):
    video_folder: Optional[str] = None
    music_folder: Optional[str] = None
    mode: Optional[str] = None
    quality: Optional[str] = None
    audio_quality: Optional[str] = None
    container: Optional[str] = None
    playlist: Optional[bool] = None
    subtitles: Optional[bool] = None
    sponsorblock: Optional[str] = None
    auto_open: Optional[bool] = None
    cookies_browser: Optional[str] = None
    cookie_file: Optional[str] = None


class ProbeIn(BaseModel):
    text: str = ""
    playlist: bool = False


class QueueItem(BaseModel):
    url: str
    title: Optional[str] = None
    thumbnail: Optional[str] = None
    uploader: Optional[str] = None
    duration: Optional[int] = None
    playlist_items: Optional[str] = None


class EnqueueIn(BaseModel):
    items: list[QueueItem] = Field(default_factory=list)
    urls: list[str] = Field(default_factory=list)
    playlist_items: Optional[str] = None
    overrides: dict[str, Any] = Field(default_factory=dict)


class PathIn(BaseModel):
    path: str
    reveal: bool = False


class ClipIn(BaseModel):
    path: str
    start: float
    end: float
    kind: str = "master"


class FrameIn(BaseModel):
    path: str
    time: float
    open_edit: bool = True


def emit(event: dict[str, Any]) -> None:
    if main_loop is None:
        return
    for bucket in list(subscribers):
        main_loop.call_soon_threadsafe(bucket.put_nowait, event)


def snapshot() -> dict[str, Any]:
    return {
        "jobs": [jobs[i] for i in job_order if i in jobs],
        "queue_len": len(queue),
        "busy": worker_busy,
    }


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    skip = {"stop", "settings"}
    return {k: v for k, v in job.items() if k not in skip}


@app.on_event("startup")
async def _startup() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()
    with settings_lock:
        current = load_settings()
    os.makedirs(current["video_folder"], exist_ok=True)
    os.makedirs(current["music_folder"], exist_ok=True)
    threading.Thread(target=_warmup_ytdlp, daemon=True).start()


def _warmup_ytdlp() -> None:
    try:
        engine.which_tools()
    except Exception:
        pass


@app.get("/api/health")
def health() -> dict[str, Any]:
    tools = engine.which_tools()
    return {
        **tools,
        "qualities": {
            "video": engine.VIDEO_QUALITY,
            "audio": engine.AUDIO_QUALITY,
            "containers": engine.CONTAINERS,
            "browsers": engine.BROWSERS,
        },
    }


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    with settings_lock:
        return load_settings()


@app.put("/api/settings")
def put_settings(body: SettingsIn) -> dict[str, Any]:
    with settings_lock:
        return save_settings(body.model_dump(exclude_none=True))


@app.post("/api/browse-folder")
def api_browse_folder() -> dict[str, str]:
    path = engine.browse_folder("612 Pull — choose folder")
    return {"path": path}


@app.post("/api/browse-file")
def api_browse_file() -> dict[str, str]:
    path = engine.browse_file("612 Pull — choose cookies.txt")
    return {"path": path}


@app.post("/api/probe")
def api_probe(body: ProbeIn) -> dict[str, Any]:
    urls = engine.extract_urls(body.text)
    if not urls:
        raise HTTPException(400, "Paste at least one http(s) URL.")
    with settings_lock:
        current = load_settings()
    results = []
    errors = []
    for url in urls[:20]:
        try:
            results.append(engine.probe(url, current, allow_playlist=body.playlist))
        except Exception as exc:
            errors.append({"url": url, "error": str(exc)})
    return {"items": results, "errors": errors}


@app.get("/api/queue")
def api_queue() -> dict[str, Any]:
    return snapshot()


@app.post("/api/queue")
def api_enqueue(body: EnqueueIn) -> dict[str, Any]:
    packed = list(body.items)
    for url in body.urls:
        packed.append(QueueItem(url=url, playlist_items=body.playlist_items))
    packed = [item for item in packed if item.url.strip()]
    if not packed:
        raise HTTPException(400, "Nothing to pull.")
    with settings_lock:
        current = {**load_settings(), **(body.overrides or {})}
    created = []
    for item in packed:
        url = item.url.strip()
        if engine.is_drm_url(url):
            raise HTTPException(400, f"DRM site blocked: {url}")
        job_id = uuid.uuid4().hex[:10]
        job = {
            "id": job_id,
            "url": url if current.get("playlist") else engine.youtube_strip_playlist(url),
            "source_url": url,
            "mode": current.get("mode") or "video",
            "quality": current.get("quality"),
            "audio_quality": current.get("audio_quality"),
            "container": current.get("container"),
            "status": "queued",
            "percent": 0,
            "speed": 0,
            "eta": 0,
            "title": item.title or url,
            "thumbnail": item.thumbnail or "",
            "uploader": item.uploader or "",
            "duration": item.duration or 0,
            "platform": engine.detect_platform(url),
            "filename": "",
            "folder": "",
            "error": "",
            "quality_note": "",
            "playlist_items": item.playlist_items or body.playlist_items,
            "created": True,
            "settings": current,
            "stop": False,
        }
        jobs[job_id] = job
        job_order.insert(0, job_id)
        queue.append(job_id)
        created.append(public_job(job))
        emit({"type": "job", "job": public_job(job)})
    start_worker()
    return {"jobs": created}


@app.post("/api/queue/{job_id}/cancel")
def api_cancel(job_id: str) -> dict[str, str]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    job["stop"] = True
    if job["status"] == "queued" and job_id in queue:
        queue.remove(job_id)
        job["status"] = "cancelled"
        emit({"type": "job", "job": public_job(job)})
    return {"ok": "cancelled"}


@app.post("/api/queue/{job_id}/retry")
def api_retry(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    job["stop"] = False
    job["status"] = "queued"
    job["percent"] = 0
    job["error"] = ""
    job["speed"] = 0
    if job_id not in queue:
        queue.append(job_id)
    emit({"type": "job", "job": public_job(job)})
    start_worker()
    return public_job(job)


@app.delete("/api/queue/{job_id}")
def api_remove(job_id: str) -> dict[str, str]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    job["stop"] = True
    if job_id in queue:
        queue.remove(job_id)
    jobs.pop(job_id, None)
    if job_id in job_order:
        job_order.remove(job_id)
    emit({"type": "removed", "id": job_id})
    return {"ok": "removed"}


@app.get("/api/history")
def api_history() -> dict[str, Any]:
    return {"items": history}


@app.delete("/api/history")
def api_clear_history() -> dict[str, str]:
    history.clear()
    save_history(history)
    return {"ok": "cleared"}


@app.post("/api/open")
def api_open(body: PathIn) -> dict[str, str]:
    if not body.path:
        raise HTTPException(400, "Missing path")
    engine.open_path(body.path, reveal=body.reveal)
    return {"ok": "opened"}


@app.post("/api/browse-media")
def api_browse_media() -> dict[str, str]:
    path = engine.browse_file("612 Pull Watch — open media")
    return {"path": path}


@app.get("/api/media/library")
def api_library() -> dict[str, Any]:
    with settings_lock:
        current = load_settings()
    items = media_engine.list_library([current.get("video_folder") or "", current.get("music_folder") or ""])
    return {"items": items}


@app.post("/api/media/probe")
def api_media_probe(body: PathIn) -> dict[str, Any]:
    try:
        return media_engine.probe(body.path)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/media/stream")
def api_media_stream(path: str, t: float = 0.0) -> StreamingResponse:
    try:
        media_engine.resolve_media(path)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return StreamingResponse(
        media_engine.stream_bytes(path, start=max(0.0, t)),
        media_type="video/mp4",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.get("/api/media/raw")
def api_media_raw(path: str):
    from fastapi.responses import FileResponse

    try:
        resolved = media_engine.resolve_readable(path)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(resolved, filename=resolved.name)


@app.get("/api/media/thumb")
def api_media_thumb(path: str):
    from fastapi.responses import FileResponse

    try:
        dest = media_engine.thumbnail_file(path)
    except Exception as exc:
        raise HTTPException(404, str(exc)) from exc
    return FileResponse(dest, media_type="image/jpeg")


@app.post("/api/media/clip")
def api_clip(body: ClipIn) -> dict[str, Any]:
    try:
        return media_engine.export_clip(body.path, body.start, body.end, kind=body.kind)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/media/frame")
def api_frame(body: FrameIn) -> dict[str, Any]:
    try:
        result = media_engine.grab_frame(body.path, body.time)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    opened = False
    url = media_engine.grokedit_url(result["path"])
    if body.open_edit:
        if media_engine.grokedit_running():
            engine.open_path(url)
            opened = True
        else:
            engine.open_path(result["path"], reveal=True)
    return {**result, "opened": opened, "edit_url": url}


@app.get("/api/media/text")
def api_media_text(path: str) -> dict[str, str]:
    try:
        return {"text": media_engine.read_text_file(path)}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/media/quicktime")
def api_quicktime(body: PathIn) -> dict[str, Any]:
    try:
        return media_engine.export_quicktime(body.path)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/update-ytdlp")
def api_update() -> dict[str, str]:
    try:
        version = engine.update_ytdlp()
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    return {"version": version}


@app.get("/api/events")
async def api_events() -> StreamingResponse:
    bucket: asyncio.Queue = asyncio.Queue()
    subscribers.append(bucket)
    await bucket.put({"type": "snapshot", **snapshot()})

    async def gen():
        try:
            while True:
                event = await bucket.get()
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            if bucket in subscribers:
                subscribers.remove(bucket)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def start_worker() -> None:
    global worker_busy
    if worker_busy:
        return
    worker_busy = True
    threading.Thread(target=_worker, daemon=True).start()


def _worker() -> None:
    global worker_busy
    try:
        while queue:
            job_id = queue.pop(0)
            job = jobs.get(job_id)
            if not job or job.get("stop"):
                if job:
                    job["status"] = "cancelled"
                    emit({"type": "job", "job": public_job(job)})
                continue
            job["status"] = "downloading"
            job["percent"] = 1
            emit({"type": "job", "job": public_job(job)})

            def on_progress(payload: dict[str, Any]) -> None:
                job.update(
                    {
                        "percent": payload.get("percent", job.get("percent") or 0),
                        "speed": payload.get("speed") or 0,
                        "eta": payload.get("eta") or 0,
                        "filename": payload.get("filename") or job.get("filename") or "",
                        "status": "postprocessing"
                        if payload.get("status") == "postprocessing"
                        else "downloading",
                    }
                )
                emit({"type": "job", "job": public_job(job)})

            try:
                result = engine.download(
                    job["url"],
                    job["settings"],
                    on_progress,
                    lambda: bool(job.get("stop")),
                    playlist_items=job.get("playlist_items"),
                )
                if job.get("stop"):
                    job["status"] = "cancelled"
                else:
                    job["status"] = "done"
                    job["percent"] = 100
                    job["filename"] = result.get("path") or job.get("filename")
                    job["folder"] = result.get("folder") or ""
                    job["quality_note"] = result.get("quality_note") or ""
                    if result.get("title"):
                        job["title"] = result["title"]
                    record = public_job(job)
                    history.insert(0, record)
                    save_history(history)
                    if job["settings"].get("auto_open") and job.get("folder"):
                        engine.open_path(job["folder"])
            except KeyboardInterrupt:
                job["status"] = "cancelled"
            except Exception as exc:
                job["status"] = "error"
                job["error"] = str(exc)
            emit({"type": "job", "job": public_job(job)})
    finally:
        worker_busy = False
        if queue:
            start_worker()


DIST = ROOT / "dist"

LANDING_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>612 Pull</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 2rem 1.25rem;
    font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #0f1115; color: #e7e9ee;
  }
  main { max-width: 30rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
  p { margin: 0 0 1rem; color: #b9bfcc; }
  strong { color: #e7e9ee; }
  a { color: #7aa2ff; }
  .note { font-size: .875rem; color: #79808f; }
</style>
</head>
<body>
<main>
  <h1>612 Pull is running</h1>
  <p>This address is the download service itself. There is no page to use here.</p>
  <p>Open your configured guest frontend and paste your
  link there — that page talks to this service for you.</p>
  <p class="note">If someone sent you here, ask them for their guest frontend link with the current
  address attached.</p>
</main>
</body>
</html>
"""


@app.get("/", include_in_schema=False)
def root_page():
    """A bare address typed into a phone browser should explain itself, not 404."""
    index = DIST / "index.html"
    if index.is_file():
        # Hand back the built UI exactly as the static mount below would.
        return FileResponse(index, media_type="text/html")
    return HTMLResponse(LANDING_HTML)


class UIFiles(StaticFiles):
    """Starlette defers its "is this a directory?" check to the first request that reaches
    the mount, so a dist/ build removed after the server started raises RuntimeError there
    instead. That escapes to the outermost error handler as a bare text/plain 500 with no
    CORS headers, which is what a phone ends up offering to download. Fall back to an
    ordinary 404 once the build is gone.
    """

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if not os.path.isdir(self.directory or ""):
            raise HTTPException(404, "Not Found")
        await super().__call__(scope, receive, send)


# Registered last so /api routes and the landing page above win the match.
if DIST.exists():
    app.mount("/", UIFiles(directory=DIST, html=True), name="ui")
