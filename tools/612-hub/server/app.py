"""Local FastAPI server for 612 Hub."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from server.config import APP_TITLE, APP_VERSION, UI_PORT
from server.catalog import PIPELINE
from server import engine

app = FastAPI(title=APP_TITLE, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[f"http://127.0.0.1:{UI_PORT}", f"http://localhost:{UI_PORT}", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "app": APP_TITLE, "version": APP_VERSION}


@app.get("/api/status")
def status() -> dict[str, Any]:
    snap = engine.snapshot()
    snap["pipeline"] = list(PIPELINE)
    snap["requirements"] = engine.requirements()
    return snap


@app.post("/api/apps/{app_id}/launch")
def launch(app_id: str, force: bool = False) -> dict[str, Any]:
    try:
        return engine.launch(app_id, force=force)
    except KeyError:
        raise HTTPException(404, "Unknown app") from None
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/apps/{app_id}/stop")
def stop(app_id: str) -> dict[str, Any]:
    try:
        return engine.stop(app_id)
    except KeyError:
        raise HTTPException(404, "Unknown app") from None
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/apps/{app_id}/open")
def open_app(app_id: str) -> dict[str, Any]:
    try:
        return engine.open_app(app_id)
    except KeyError:
        raise HTTPException(404, "Unknown app") from None
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/stop-others")
def stop_others(keep: Optional[str] = None) -> dict[str, Any]:
    return engine.stop_others(keep)


@app.post("/api/reveal")
def reveal(body: dict[str, Any]) -> dict[str, Any]:
    path = body.get("path") or ""
    in_finder = bool(body.get("finder"))
    try:
        engine.reveal(path, in_finder=in_finder)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/open-path")
def open_path(body: dict[str, str]) -> dict[str, Any]:
    path = body.get("path") or ""
    try:
        engine.open_path(path)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/media")
def media() -> dict[str, Any]:
    return {"items": engine.list_media()}


@app.post("/api/media/delete")
def delete_media(body: dict[str, str]) -> dict[str, Any]:
    path = body.get("path") or ""
    try:
        return engine.delete_media(path)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/prefs")
def get_prefs() -> dict[str, Any]:
    prefs = engine.load_prefs()
    return {"auto_open": bool(prefs.get("auto_open"))}


@app.post("/api/prefs")
def set_prefs(body: dict[str, Any]) -> dict[str, Any]:
    prefs = engine.patch_prefs(body)
    return {"auto_open": bool(prefs.get("auto_open"))}
