"""Local FastAPI server for 612 Harvest."""

from __future__ import annotations

import asyncio
import json
import threading
import traceback
import uuid
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from server.config import APP_TITLE, APP_VERSION, PROJECTS_DIR, save_config
from server.engine.io_util import HTTP, resolve_media
from server import pipeline

app = FastAPI(title=APP_TITLE, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5179", "http://localhost:5179", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs: dict[str, dict[str, Any]] = {}
job_order: list[str] = []
queue: list[str] = []
subscribers: list[asyncio.Queue] = []
worker_busy = False
main_loop: Optional[asyncio.AbstractEventLoop] = None
jobs_lock = threading.Lock()

ALLOWED_HOSTS = (
    "images.pexels.com",
    "videos.pexels.com",
    "player.vimeo.com",
    "i.vimeocdn.com",
    "cdn.pixabay.com",
    "pixabay.com",
    "images.unsplash.com",
    "plus.unsplash.com",
    "images.nasa.gov",
    "images-assets.nasa.gov",
    "images-av.nasa.gov",
    "upload.wikimedia.org",
    "commons.wikimedia.org",
    "api.openverse.org",
    "live.staticflickr.com",
    "farm1.staticflickr.com",
    "farm2.staticflickr.com",
    "farm3.staticflickr.com",
    "farm4.staticflickr.com",
    "farm5.staticflickr.com",
    "farm6.staticflickr.com",
    "farm7.staticflickr.com",
    "farm8.staticflickr.com",
    "farm9.staticflickr.com",
)


class ParseIn(BaseModel):
    text: str
    name: str = "Untitled reel"
    mode: str = "outline"


class PatchIn(BaseModel):
    name: Optional[str] = None
    sections: Optional[list[dict[str, Any]]] = None
    settings: Optional[dict[str, Any]] = None


class KeepIn(BaseModel):
    uids: list[str]
    kept: bool = True


class KeepBestIn(BaseModel):
    shot_id: str
    count: int = 3


class ScoutIn(BaseModel):
    shot_id: Optional[str] = None


class PullIn(BaseModel):
    keepers_only: bool = True


class ShotIn(BaseModel):
    section_slug: str
    query: str
    category: str = "stock"


class ConfigIn(BaseModel):
    pexels: str = ""
    pixabay: str = ""
    unsplash: str = ""


def emit(event: dict[str, Any]) -> None:
    if main_loop is None:
        return
    for bucket in list(subscribers):
        main_loop.call_soon_threadsafe(bucket.put_nowait, event)


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in job.items() if k != "stop"}


def snapshot() -> dict[str, Any]:
    with jobs_lock:
        return {
            "jobs": [public_job(jobs[i]) for i in job_order if i in jobs],
            "queue_len": len(queue),
            "busy": worker_busy,
        }


def update_job(job_id: str, **fields: Any) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job.update(fields)
        payload = public_job(job)
    emit({"type": "job", "job": payload})


def enqueue_job(project: str, kind: str, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:10]
    job = {
        "id": job_id,
        "project": project,
        "kind": kind,
        "status": "queued",
        "progress": 0.0,
        "step": "Queued",
        "error": None,
        "payload": payload or {},
        "stop": threading.Event(),
    }
    with jobs_lock:
        jobs[job_id] = job
        job_order.insert(0, job_id)
        queue.append(job_id)
    emit({"type": "job", "job": public_job(job)})
    threading.Thread(target=_pump, daemon=True).start()
    return public_job(job)


def _pump() -> None:
    global worker_busy
    with jobs_lock:
        if worker_busy or not queue:
            return
        worker_busy = True
        job_id = queue.pop(0)
    try:
        _run_job(job_id)
    finally:
        with jobs_lock:
            worker_busy = False
            more = bool(queue)
        if more:
            threading.Thread(target=_pump, daemon=True).start()
        emit({"type": "snapshot", **snapshot()})


def _run_job(job_id: str) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job["status"] == "cancelled":
            return
        kind = job["kind"]
        project = job["project"]
        payload = job.get("payload") or {}

    def progress(value: float, step: str) -> None:
        update_job(job_id, status="running", progress=round(float(value), 3), step=step)

    update_job(job_id, status="running", progress=0.01, step="Starting")
    try:
        if kind == "scout":
            pipeline.scout_project(project, payload.get("shot_id"), progress)
        elif kind == "pull":
            pipeline.pull_project(project, bool(payload.get("keepers_only", True)), progress)
        else:
            raise RuntimeError(f"Unknown job {kind}")
        update_job(job_id, status="done", progress=1.0, step="Done")
        emit({"type": "project", "slug": project, "project": pipeline.summary(project)})
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        update_job(job_id, status="error", step="Failed", error=str(exc))


@app.on_event("startup")
async def _startup() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    return pipeline.health()


@app.get("/api/config")
def api_config() -> dict[str, Any]:
    return pipeline.public_config()


@app.post("/api/config")
def api_save_config(body: ConfigIn) -> dict[str, Any]:
    update: dict[str, Any] = {"providers": {}}
    if body.pexels.strip():
        update["providers"]["pexels"] = {"api_key": body.pexels.strip()}
    if body.pixabay.strip():
        update["providers"]["pixabay"] = {"api_key": body.pixabay.strip()}
    if body.unsplash.strip():
        update["providers"]["unsplash"] = {"access_key": body.unsplash.strip()}
    if update["providers"]:
        save_config(update)
    return pipeline.public_config()


@app.post("/api/parse")
def api_parse(body: ParseIn) -> dict[str, Any]:
    try:
        return pipeline.create_from_text(body.text, body.name, body.mode)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/upload")
async def api_upload(
    file: UploadFile = File(...),
    name: str = Form("Untitled reel"),
    mode: str = Form("outline"),
) -> dict[str, Any]:
    text = (await file.read()).decode("utf-8", errors="replace")
    try:
        return pipeline.create_from_text(text, name or (file.filename or "Untitled reel"), mode)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects")
def api_projects() -> dict[str, Any]:
    return {"projects": pipeline.list_summaries()}


@app.get("/api/projects/{slug}")
def api_project(slug: str) -> dict[str, Any]:
    try:
        return pipeline.detail(slug)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.patch("/api/projects/{slug}")
def api_patch(slug: str, body: PatchIn) -> dict[str, Any]:
    try:
        return pipeline.patch_project(slug, body.model_dump(exclude_none=True))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/projects/{slug}")
def api_delete(slug: str) -> dict[str, str]:
    pipeline.remove_project(slug)
    return {"ok": "deleted"}


@app.post("/api/projects/{slug}/shots")
def api_add_shot(slug: str, body: ShotIn) -> dict[str, Any]:
    try:
        return pipeline.add_shot(slug, body.section_slug, body.query, body.category)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/projects/{slug}/scout")
def api_scout(slug: str, body: ScoutIn | None = None) -> dict[str, Any]:
    shot_id = body.shot_id if body else None
    return enqueue_job(slug, "scout", {"shot_id": shot_id})


@app.post("/api/projects/{slug}/keep")
def api_keep(slug: str, body: KeepIn) -> dict[str, Any]:
    try:
        return pipeline.set_kept(slug, body.uids, body.kept)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/projects/{slug}/keep-best")
def api_keep_best(slug: str, body: KeepBestIn) -> dict[str, Any]:
    try:
        return pipeline.keep_best(slug, body.shot_id, body.count)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/projects/{slug}/pull")
def api_pull(slug: str, body: PullIn | None = None) -> dict[str, Any]:
    keepers_only = body.keepers_only if body else True
    return enqueue_job(slug, "pull", {"keepers_only": keepers_only})


@app.post("/api/projects/{slug}/open")
def api_open(slug: str) -> dict[str, str]:
    try:
        return {"path": pipeline.open_folder(slug)}
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/media/{slug}/{rel:path}")
def api_media(slug: str, rel: str) -> FileResponse:
    try:
        path = resolve_media(slug, rel)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(path)


@app.get("/api/thumb")
def api_thumb(url: str) -> Response:
    host = (urlparse(url).hostname or "").lower()
    if not host or not any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_HOSTS):
        raise HTTPException(400, "blocked host")
    try:
        response = HTTP.get(url, timeout=20, stream=True)
        response.raise_for_status()
        content_type = response.headers.get("content-type") or "image/jpeg"
        return Response(content=response.content, media_type=content_type.split(";")[0])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/queue")
def api_queue() -> dict[str, Any]:
    return snapshot()


@app.post("/api/queue/{job_id}/cancel")
def api_cancel(job_id: str) -> dict[str, str]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Unknown job")
        if job_id in queue:
            queue.remove(job_id)
        job["status"] = "cancelled"
        job["step"] = "Cancelled"
        job["stop"].set()
        payload = public_job(job)
    emit({"type": "job", "job": payload})
    return {"ok": "cancelled"}


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
        except asyncio.CancelledError:
            pass
        finally:
            if bucket in subscribers:
                subscribers.remove(bucket)

    return StreamingResponse(gen(), media_type="text/event-stream")
