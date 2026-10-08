"""Local FastAPI server for 612 Mix."""
from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import threading
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from server.config import APP_TITLE, APP_VERSION, PROJECTS_DIR, STEM_METHOD_DEFAULT, SUPPORTED_FORMATS
from server.engine.separation import DEMUCS_AVAILABLE, get_available_methods
from server import pipeline

ROOT = Path(__file__).resolve().parent.parent

app = FastAPI(title=APP_TITLE, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5177",
        "http://localhost:5177",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
        "*",
    ],
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


class JobIn(BaseModel):
    method: str = STEM_METHOD_DEFAULT


class RemixIn(BaseModel):
    preset_id: str = "phat_analog"
    enabled_layers: list[str] = Field(default_factory=lambda: ["drums", "bass", "melody", "chords"])
    layer_sounds: dict[str, str] = Field(default_factory=dict)
    intensity: float = 0.0
    seed: Optional[int] = None


def emit(event: dict[str, Any]) -> None:
    if main_loop is None:
        return
    for bucket in list(subscribers):
        main_loop.call_soon_threadsafe(bucket.put_nowait, event)


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in job.items() if k not in {"stop"}}


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


def enqueue_job(project: str, kind: str, method: str = STEM_METHOD_DEFAULT) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:10]
    job = {
        "id": job_id,
        "project": project,
        "kind": kind,
        "method": method,
        "status": "queued",
        "progress": 0.0,
        "step": "Queued",
        "error": None,
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
        if worker_busy:
            return
        if not queue:
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
        if not job:
            return
        kind = job["kind"]
        project = job["project"]
        method = job.get("method") or STEM_METHOD_DEFAULT
        if job["status"] == "cancelled":
            return

    def progress(value: float, step: str) -> None:
        update_job(job_id, status="running", progress=round(float(value), 3), step=step)

    update_job(job_id, status="running", progress=0.01, step="Starting")
    try:
        if kind == "split":
            pipeline.split_project(project, method, progress)
        elif kind == "analyze":
            pipeline.analyze_project(project, progress)
        elif kind == "strudel":
            pipeline.generate_strudel(project, progress)
        elif kind == "pipeline":
            pipeline.run_pipeline(project, method, progress)
        else:
            raise RuntimeError(f"Unknown job {kind}")
        update_job(job_id, status="done", progress=1.0, step="Done")
        emit({"type": "project", "project": pipeline.project_summary(project)})
    except Exception as exc:
        traceback.print_exc()
        update_job(job_id, status="error", step="Failed", error=str(exc))


@app.on_event("startup")
async def _startup() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "app": APP_TITLE,
        "version": APP_VERSION,
        "device": pipeline.device_name(),
        "demucs": DEMUCS_AVAILABLE,
        "methods": get_available_methods(),
        "formats": SUPPORTED_FORMATS,
    }


@app.get("/api/projects")
def api_projects() -> dict[str, Any]:
    return {"projects": pipeline.list_project_summaries()}


@app.post("/api/projects")
async def api_create_project(
    file: UploadFile = File(...),
    name: str = Form(""),
) -> dict[str, Any]:
    suffix = Path(file.filename or "track.wav").suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        raise HTTPException(400, f"Unsupported format {suffix}")
    tmp = Path(tempfile.mkdtemp(prefix="grokmix-")) / (file.filename or f"track{suffix}")
    try:
        with tmp.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        summary = pipeline.create_project_from_upload(tmp, name or file.filename)
        return summary
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)


@app.get("/api/projects/{name}")
def api_project(name: str) -> dict[str, Any]:
    try:
        return pipeline.project_detail(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/projects/{name}")
def api_delete_project(name: str) -> dict[str, str]:
    pipeline.delete_project(name)
    return {"ok": "deleted"}


@app.post("/api/projects/{name}/split")
def api_split(name: str, body: JobIn | None = None) -> dict[str, Any]:
    method = (body.method if body else None) or STEM_METHOD_DEFAULT
    return enqueue_job(name, "split", method)


@app.post("/api/projects/{name}/analyze")
def api_analyze(name: str) -> dict[str, Any]:
    return enqueue_job(name, "analyze")


@app.post("/api/projects/{name}/strudel")
def api_strudel(name: str) -> dict[str, Any]:
    return enqueue_job(name, "strudel")


@app.post("/api/projects/{name}/pipeline")
def api_pipeline(name: str, body: JobIn | None = None) -> dict[str, Any]:
    method = (body.method if body else None) or STEM_METHOD_DEFAULT
    return enqueue_job(name, "pipeline", method)


@app.post("/api/projects/{name}/remix")
def api_remix(name: str, body: RemixIn) -> dict[str, str]:
    try:
        return pipeline.custom_remix(
            name,
            preset_id=body.preset_id,
            enabled_layers=body.enabled_layers,
            layer_sounds=body.layer_sounds,
            intensity=body.intensity,
            seed=body.seed,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/media/{name}/{rel:path}")
def api_media(name: str, rel: str) -> FileResponse:
    try:
        path = pipeline.resolve_media(name, rel)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(path)


@app.get("/api/slices/{name}/{stem}/{filename}")
def api_slice(name: str, stem: str, filename: str) -> FileResponse:
    try:
        path = pipeline.resolve_slice(name, stem, filename)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(path, headers={"Access-Control-Allow-Origin": "*"})


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
