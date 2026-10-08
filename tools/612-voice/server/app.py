"""Local FastAPI server for 612 Voice."""
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

from server import pipeline
from server.config import APP_TITLE, APP_VERSION, SHOWS_DIR

app = FastAPI(title=APP_TITLE, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5178",
        "http://localhost:5178",
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


class ShowIn(BaseModel):
    title: str = "Untitled show"


class ShowPatch(BaseModel):
    title: Optional[str] = None
    mode: Optional[str] = None
    engine: Optional[str] = None
    story_text: Optional[str] = None
    cast: Optional[dict[str, str]] = None
    settings: Optional[dict[str, Any]] = None
    lines: Optional[list[dict[str, Any]]] = None


class SplitIn(BaseModel):
    text: str
    mode: str = "sentence"


class StoryIn(BaseModel):
    text: Optional[str] = None


class RenderIn(BaseModel):
    indices: Optional[list[int]] = None


class EmphasisIn(BaseModel):
    indices: list[int]
    preset: str = "normal"


class VoicePatch(BaseModel):
    name: Optional[str] = None
    exaggeration: Optional[float] = None
    cfg_weight: Optional[float] = None
    temperature: Optional[float] = None


class YoutubeIn(BaseModel):
    url: str
    name: str = ""
    start: str = "0"
    duration: float = 15.0


class EffectsIn(BaseModel):
    index: int
    gain_db: float = 0.0
    pitch_semitones: float = 0.0
    highpass_hz: float = 0.0
    lowpass_hz: float = 0.0
    reverb: float = 0.0


def emit(event: dict[str, Any]) -> None:
    if main_loop is None:
        return
    for bucket in list(subscribers):
        main_loop.call_soon_threadsafe(bucket.put_nowait, event)


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in job.items() if k not in {"stop", "payload"}}


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


def enqueue_job(show: str, kind: str, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:10]
    job = {
        "id": job_id,
        "project": show,
        "kind": kind,
        "status": "queued",
        "progress": 0.0,
        "step": "Queued",
        "error": None,
        "stop": threading.Event(),
        "payload": payload or {},
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
        show = job["project"]
        payload = job.get("payload") or {}
        if job["status"] == "cancelled":
            return

    def progress(value: float, step: str) -> None:
        update_job(job_id, status="running", progress=round(float(value), 3), step=step)

    update_job(job_id, status="running", progress=0.01, step="Starting")
    try:
        detail = None
        if kind == "render":
            detail = pipeline.render_lines(show, payload.get("indices"), progress)
        elif kind == "concat":
            detail = pipeline.concat_show(show, progress)
        elif kind == "effects":
            detail = pipeline.effect_take(show, int(payload["index"]), payload, progress)
        elif kind == "youtube":
            progress(0.15, "Downloading YouTube audio")
            voice = pipeline.add_voice_from_youtube(
                payload["url"], payload.get("name") or "", payload.get("start") or "0", float(payload.get("duration") or 15)
            )
            emit({"type": "voice", "voice": voice})
        else:
            raise RuntimeError(f"Unknown job {kind}")
        update_job(job_id, status="done", progress=1.0, step="Done")
        if detail:
            emit({"type": "show", "show": detail})
    except Exception as exc:
        traceback.print_exc()
        update_job(job_id, status="error", step="Failed", error=str(exc))


@app.on_event("startup")
async def _startup() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()
    pipeline.ensure_dirs()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return pipeline.health()


@app.get("/api/voices")
def api_voices() -> dict[str, Any]:
    return {"voices": [pipeline.public_voice(v) for v in pipeline.load_voices()]}


@app.post("/api/voices")
async def api_voice_upload(
    file: UploadFile = File(...),
    name: str = Form(""),
) -> dict[str, Any]:
    suffix = Path(file.filename or "voice.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".flac", ".aiff", ".aif"}:
        raise HTTPException(400, f"Unsupported format {suffix}")
    tmp = Path(tempfile.mkdtemp(prefix="grokvoice-")) / (file.filename or f"voice{suffix}")
    try:
        with tmp.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        return pipeline.add_voice_from_file(tmp, name or Path(file.filename or "voice").stem)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)


@app.post("/api/voices/youtube")
def api_voice_youtube(body: YoutubeIn) -> dict[str, Any]:
    return enqueue_job(
        "_voices",
        "youtube",
        {"url": body.url, "name": body.name, "start": body.start, "duration": body.duration},
    )


@app.patch("/api/voices/{voice_id}")
def api_voice_patch(voice_id: str, body: VoicePatch) -> dict[str, Any]:
    try:
        return pipeline.update_voice(voice_id, body.model_dump(exclude_none=True))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.delete("/api/voices/{voice_id}")
def api_voice_delete(voice_id: str) -> dict[str, str]:
    pipeline.delete_voice(voice_id)
    return {"ok": "deleted"}


@app.get("/api/shows")
def api_shows() -> dict[str, Any]:
    return {"shows": pipeline.list_shows()}


@app.post("/api/shows")
def api_create_show(body: ShowIn) -> dict[str, Any]:
    return pipeline.create_show(body.title)


@app.get("/api/shows/{name}")
def api_show(name: str) -> dict[str, Any]:
    try:
        return pipeline.show_detail(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.patch("/api/shows/{name}")
def api_patch_show(name: str, body: ShowPatch) -> dict[str, Any]:
    try:
        return pipeline.patch_show(name, body.model_dump(exclude_none=True))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/shows/{name}")
def api_delete_show(name: str) -> dict[str, str]:
    try:
        pipeline.delete_show(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": "deleted"}


@app.post("/api/shows/{name}/split")
def api_split(name: str, body: SplitIn) -> dict[str, Any]:
    try:
        return pipeline.set_lines_from_text(name, body.text, body.mode)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/shows/{name}/story")
def api_story(name: str, body: StoryIn) -> dict[str, Any]:
    try:
        return pipeline.set_lines_from_story(name, body.text)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/shows/{name}/emphasis")
def api_emphasis(name: str, body: EmphasisIn) -> dict[str, Any]:
    try:
        return pipeline.apply_emphasis(name, body.indices, body.preset)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/shows/{name}/render")
def api_render(name: str, body: RenderIn | None = None) -> dict[str, Any]:
    return enqueue_job(name, "render", {"indices": body.indices if body else None})


@app.post("/api/shows/{name}/concat")
def api_concat(name: str) -> dict[str, Any]:
    return enqueue_job(name, "concat")


@app.post("/api/shows/{name}/effects")
def api_effects(name: str, body: EffectsIn) -> dict[str, Any]:
    return enqueue_job(name, "effects", body.model_dump())


@app.get("/api/media/{name}/{rel:path}")
def api_media(name: str, rel: str) -> FileResponse:
    root = (SHOWS_DIR / name).resolve()
    path = (root / rel).resolve()
    if not str(path).startswith(str(root)) or not path.exists() or not path.is_file():
        raise HTTPException(404, "Missing file")
    return FileResponse(path)


@app.get("/api/voice-media/{voice_id}")
def api_voice_media(voice_id: str) -> FileResponse:
    voice = pipeline.voice_by_id(voice_id)
    if not voice:
        raise HTTPException(404, "Unknown voice")
    path = pipeline.voice_path(voice)
    if not path:
        raise HTTPException(404, "Missing prompt")
    return FileResponse(path)


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
