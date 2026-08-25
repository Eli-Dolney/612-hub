"""Local FastAPI server for GrokClip."""

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
from pydantic import BaseModel

from server.config import APP_TITLE, APP_VERSION, PROJECTS_DIR, SUPPORTED, UI_PORT
from server import pipeline

app = FastAPI(title=APP_TITLE, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://127.0.0.1:{UI_PORT}",
        f"http://localhost:{UI_PORT}",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
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


class ImportIn(BaseModel):
    path: str
    name: str = ""


class SettingsIn(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class KeepIn(BaseModel):
    ids: list[int]
    kept: bool = True


class KeepAllIn(BaseModel):
    kept: bool = True


class ClipIn(BaseModel):
    start: float
    end: float
    label: str = ""
    kept: bool = True


class ClipPatch(BaseModel):
    start: Optional[float] = None
    end: Optional[float] = None
    label: Optional[str] = None
    kept: Optional[bool] = None


class OrderIn(BaseModel):
    name: str = ""
    source: dict[str, Any]
    steps: list[dict[str, Any]]
    settings: Optional[dict[str, Any]] = None


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


def enqueue_job(project: str, kind: str, **extra: Any) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:10]
    job = {
        "id": job_id,
        "project": project,
        "kind": kind,
        "status": "queued",
        "progress": 0.0,
        "step": "Queued",
        "error": None,
        "stop": threading.Event(),
        **extra,
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
        stop = job["stop"]
        if job["status"] == "cancelled":
            return

    def progress(value: float, step: str) -> None:
        if stop.is_set():
            raise RuntimeError("Cancelled")
        update_job(job_id, status="running", progress=round(float(value), 3), step=step)

    update_job(job_id, status="running", progress=0.01, step="Starting")
    try:
        lines = None
        if kind == "probe":
            pipeline.probe_project(project, progress)
        elif kind == "transcribe":
            result = pipeline.transcribe_project(project, progress, stop=stop.is_set)
            lines = result.get("lines")
        elif kind == "export":
            pipeline.export_project(project, progress)
        elif kind == "clip":
            pipeline.export_clip(project, int(job["clip_id"]), progress)
        elif kind == "order":
            from server.engine.orders import run_order

            run_order(job, progress, stop.is_set, lambda **fields: update_job(job_id, **fields))
        else:
            raise RuntimeError(f"Unknown job {kind}")
        step = "Done"
        folder = None
        filename = None
        if kind == "transcribe":
            step = f"{lines} lines" if lines else "No speech found"
        if kind == "order":
            step = "Order done"
        if kind == "clip":
            step = "Clip saved"
            slug = project
            bundle = pipeline.load_project(slug).get("bundle") or {}
            files = bundle.get("clip_files") or []
            if files:
                dest = pipeline.project_dir(slug) / files[-1]
                if dest.is_file():
                    filename = str(dest)
                    folder = str(dest.parent)
            if not folder:
                folder = str(pipeline.project_dir(slug) / "bundle" / "clips")
        if kind == "export":
            step = "Bundle ready"
            root = pipeline.project_dir(project) / "bundle"
            primary = root / "primary.mp4"
            folder = str(root)
            if primary.is_file():
                filename = str(primary)
        if kind == "order" and project:
            try:
                root = pipeline.project_dir(project) / "bundle"
                if root.is_dir():
                    folder = str(root)
                    primary = root / "primary.mp4"
                    if primary.is_file():
                        filename = str(primary)
            except Exception:
                pass
        update_job(
            job_id,
            status="done",
            progress=1.0,
            step=step,
            folder=folder,
            filename=filename,
        )
        with jobs_lock:
            slug = jobs.get(job_id, {}).get("project") or project
        if slug:
            emit({"type": "project", "project": pipeline.summary(slug)})
    except Exception as exc:
        traceback.print_exc()
        status = "cancelled" if "Cancel" in str(exc) else "error"
        update_job(job_id, status=status, step="Failed" if status == "error" else "Cancelled", error=str(exc))


@app.on_event("startup")
async def _startup() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return pipeline.health()


@app.get("/api/projects")
def api_projects() -> dict[str, Any]:
    return {"projects": pipeline.list_project_summaries()}


@app.get("/api/pulls")
def api_pulls() -> dict[str, Any]:
    return {"files": pipeline.list_pulls()}


@app.post("/api/projects")
async def api_create_project(
    file: UploadFile = File(...),
    name: str = Form(""),
) -> dict[str, Any]:
    suffix = Path(file.filename or "clip.mp4").suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(400, f"Unsupported format {suffix}")
    tmp = Path(tempfile.mkdtemp(prefix="grokclip-")) / (file.filename or f"clip{suffix}")
    try:
        with tmp.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        row = pipeline.create_from_file(
            tmp,
            name or Path(file.filename or "clip").stem,
            require_home=False,
        )
        enqueue_job(row["slug"], "probe")
        return row
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)


@app.post("/api/import")
def api_import(body: ImportIn) -> dict[str, Any]:
    try:
        row = pipeline.create_from_file(Path(body.path), body.name)
        enqueue_job(row["slug"], "probe")
        return row
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{slug}")
def api_project(slug: str) -> dict[str, Any]:
    try:
        return pipeline.detail(slug)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None


@app.patch("/api/projects/{slug}")
def api_patch(slug: str, body: SettingsIn) -> dict[str, Any]:
    try:
        return pipeline.patch_project(slug, name=body.name, settings=body.settings)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None


@app.post("/api/projects/{slug}/logo")
async def api_logo(slug: str, file: UploadFile = File(...)) -> dict[str, Any]:
    suffix = Path(file.filename or "logo.png").suffix.lower()
    if suffix not in pipeline.LOGO_EXT:
        raise HTTPException(400, "Logo must be a PNG, JPG, WebP, or GIF")
    tmp = Path(tempfile.mkdtemp(prefix="grokclip-logo-")) / f"logo{suffix}"
    try:
        with tmp.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        return pipeline.save_logo(slug, tmp)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)


@app.delete("/api/projects/{slug}/logo")
def api_clear_logo(slug: str) -> dict[str, Any]:
    try:
        return pipeline.clear_logo(slug)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None


@app.delete("/api/projects/{slug}")
def api_delete(slug: str) -> dict[str, Any]:
    pipeline.delete_project(slug)
    return {"ok": True}


@app.post("/api/projects/{slug}/keep")
def api_keep(slug: str, body: KeepIn) -> dict[str, Any]:
    try:
        return pipeline.set_kept(slug, body.ids, body.kept)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None


@app.post("/api/projects/{slug}/keep-all")
def api_keep_all(slug: str, body: KeepAllIn) -> dict[str, Any]:
    try:
        return pipeline.set_kept_all(slug, body.kept)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None


@app.post("/api/projects/{slug}/clips")
def api_add_clip(slug: str, body: ClipIn) -> dict[str, Any]:
    try:
        return pipeline.add_clip(slug, body.start, body.end, body.label, body.kept)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.patch("/api/projects/{slug}/clips/{clip_id}")
def api_patch_clip(slug: str, clip_id: int, body: ClipPatch) -> dict[str, Any]:
    try:
        return pipeline.patch_clip(slug, clip_id, body.model_dump(exclude_unset=True))
    except FileNotFoundError as exc:
        msg = str(exc)
        raise HTTPException(404, "Clip not found" if "Clip" in msg else "Project not found") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/projects/{slug}/clips/{clip_id}")
def api_delete_clip(slug: str, clip_id: int) -> dict[str, Any]:
    try:
        return pipeline.delete_clip(slug, clip_id)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None


@app.post("/api/projects/{slug}/clips/{clip_id}/export")
def api_export_clip(slug: str, clip_id: int) -> dict[str, Any]:
    try:
        pipeline.load_project(slug)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None
    return enqueue_job(slug, "clip", clip_id=clip_id, title="Save clip")


@app.post("/api/projects/{slug}/probe")
def api_probe(slug: str) -> dict[str, Any]:
    return enqueue_job(slug, "probe")


@app.post("/api/projects/{slug}/transcribe")
def api_transcribe(slug: str) -> dict[str, Any]:
    return enqueue_job(slug, "transcribe")


@app.post("/api/projects/{slug}/export")
def api_export(slug: str) -> dict[str, Any]:
    return enqueue_job(slug, "export")


@app.post("/api/projects/{slug}/open")
def api_open(slug: str) -> dict[str, Any]:
    try:
        pipeline.open_bundle(slug)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{slug}/grokedit")
def api_grokedit(slug: str) -> dict[str, Any]:
    try:
        return pipeline.open_thumbnail_in_grokedit(slug)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/orders")
def api_order(body: OrderIn) -> dict[str, Any]:
    source = body.source or {}
    kind = source.get("kind")
    if kind not in ("project", "url"):
        raise HTTPException(400, "Source must be this clip or a URL")
    if kind == "url":
        from server.engine.pull import validate_url, ytdlp_available

        try:
            validate_url(str(source.get("url") or ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if not ytdlp_available():
            raise HTTPException(400, "yt-dlp is missing. From grok-clip run: .venv/bin/pip install yt-dlp")
    if kind == "project" and not source.get("slug"):
        raise HTTPException(400, "Pick a clip first")
    if not body.steps:
        raise HTTPException(400, "Add at least one step")
    title = (body.name or "").strip() or "Order"
    recipe = {
        "name": title,
        "source": source,
        "steps": body.steps,
        "settings": body.settings or {},
    }
    project = str(source.get("slug") or "")
    return enqueue_job(project, "order", recipe=recipe, title=title, step_index=0, steps_total=len(body.steps))


@app.get("/api/queue")
def api_queue() -> dict[str, Any]:
    return snapshot()


@app.post("/api/queue/{job_id}/cancel")
def api_cancel(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        job["stop"].set()
        if job["status"] == "queued" and job_id in queue:
            queue.remove(job_id)
            job["status"] = "cancelled"
            job["step"] = "Cancelled"
        payload = public_job(job)
    emit({"type": "job", "job": payload})
    return payload


@app.get("/api/events")
async def api_events():
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

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/media/raw")
def api_media_raw(path: str):
    try:
        resolved = pipeline.under_home(Path(path))
        if not resolved.is_file():
            raise FileNotFoundError(path)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(resolved, filename=resolved.name)


@app.get("/api/media/{slug}/{rel:path}")
def api_media(slug: str, rel: str):
    try:
        root = pipeline.project_dir(slug).resolve()
        dest = (root / rel).resolve()
        if root not in dest.parents and dest != root:
            raise HTTPException(400, "Bad path")
        if not dest.is_file():
            raise HTTPException(404, "Missing file")
    except FileNotFoundError:
        raise HTTPException(404, "Project not found") from None
    return FileResponse(dest, filename=dest.name)
