"""Local watch-folder inbox. Drop files → probe → recipe. Not a downloader."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from server.config import DEFAULT_INBOX, INBOX_DIR, INBOX_RECIPES, ROOT, SUPPORTED

STATE_PATH = ROOT / "inbox_state.json"
EnqueueFn = Callable[..., dict[str, Any]]

_lock = threading.Lock()
_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_seen: set[str] = set()
_recent: list[dict[str, Any]] = []
_enqueue: Optional[EnqueueFn] = None


def _load_state() -> dict[str, Any]:
    if STATE_PATH.is_file():
        try:
            data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            return {**DEFAULT_INBOX, **data}
        except Exception:
            pass
    return dict(DEFAULT_INBOX)


def _save_state(data: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def inbox_path(state: Optional[dict[str, Any]] = None) -> Path:
    state = state or _load_state()
    raw = str(state.get("path") or "").strip()
    path = Path(raw).expanduser() if raw else INBOX_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_inbox() -> dict[str, Any]:
    state = _load_state()
    path = inbox_path(state)
    return {
        **state,
        "path": str(path),
        "watching": bool(state.get("enabled")) and _thread is not None and _thread.is_alive(),
        "recipes": list(INBOX_RECIPES),
        "recent": list(_recent[:20]),
    }


def patch_inbox(fields: dict[str, Any]) -> dict[str, Any]:
    state = _load_state()
    if "enabled" in fields and fields["enabled"] is not None:
        state["enabled"] = bool(fields["enabled"])
    if "recipe" in fields and fields["recipe"] is not None:
        recipe = str(fields["recipe"])
        if recipe not in INBOX_RECIPES:
            raise ValueError(f"recipe must be one of {', '.join(INBOX_RECIPES)}")
        state["recipe"] = recipe
    if "path" in fields and fields["path"] is not None:
        state["path"] = str(fields["path"] or "").strip()
    _save_state(state)
    if state.get("enabled"):
        start_watcher()
    else:
        stop_watcher()
    return get_inbox()


def recipe_steps(recipe: str) -> list[dict[str, Any]]:
    if recipe == "suggest":
        return [
            {"id": "t1", "op": "transcribe"},
            {"id": "s1", "op": "suggest", "mode": "hooks", "target_s": 30},
        ]
    if recipe == "silent":
        return [
            {"id": "tr1", "op": "trim", "mode": "keep", "start": 0, "duration": 30},
            {"id": "e1", "op": "export", "captions": False},
        ]
    # shorts
    return [
        {"id": "t1", "op": "transcribe"},
        {"id": "e1", "op": "export", "captions": True},
    ]


def recipe_for_order(recipe: str, slug: str) -> dict[str, Any]:
    labels = {"suggest": "Inbox suggest", "shorts": "Inbox shorts", "silent": "Inbox silent"}
    return {
        "name": labels.get(recipe, "Inbox"),
        "source": {"kind": "project", "slug": slug},
        "steps": recipe_steps(recipe),
        "settings": {},
    }


def open_inbox_folder() -> str:
    from server.pipeline import reveal

    path = inbox_path()
    reveal(path)
    return str(path)


def _stable(path: Path, wait: float = 1.2) -> bool:
    try:
        a = path.stat().st_size
        time.sleep(wait)
        b = path.stat().st_size
        return a == b and a > 0
    except OSError:
        return False


def _process_file(path: Path) -> None:
    from server import pipeline

    key = str(path.resolve())
    with _lock:
        if key in _seen:
            return
        _seen.add(key)
    if not _stable(path):
        with _lock:
            _seen.discard(key)
        return
    state = _load_state()
    recipe = str(state.get("recipe") or "shorts")
    try:
        row = pipeline.create_from_file(path, path.stem, require_home=False)
        slug = row["slug"]
        if _enqueue is None:
            return
        job = _enqueue(
            slug,
            "order",
            recipe=recipe_for_order(recipe, slug),
            title=f"Inbox {recipe}",
            step_index=0,
            steps_total=2,
        )
        # Park the source so a restart does not re-ingest it
        done = path.parent / ".done"
        done.mkdir(parents=True, exist_ok=True)
        dest = done / path.name
        if dest.exists():
            dest = done / f"{path.stem}_{int(time.time())}{path.suffix}"
        try:
            path.rename(dest)
        except OSError:
            pass
        entry = {
            "path": key,
            "name": path.name,
            "slug": slug,
            "recipe": recipe,
            "job_id": job.get("id"),
            "at": time.time(),
        }
        with _lock:
            _recent.insert(0, entry)
            del _recent[40:]
    except Exception as exc:
        with _lock:
            _recent.insert(
                0,
                {"path": key, "name": path.name, "error": str(exc), "at": time.time()},
            )
            del _recent[40:]
            _seen.discard(key)


def _loop() -> None:
    while not _stop.is_set():
        state = _load_state()
        if not state.get("enabled"):
            break
        folder = inbox_path(state)
        try:
            for path in sorted(folder.iterdir()):
                if _stop.is_set():
                    break
                if not path.is_file():
                    continue
                if path.name.startswith("."):
                    continue
                if path.suffix.lower() not in SUPPORTED:
                    continue
                _process_file(path)
        except Exception:
            pass
        _stop.wait(2.0)


def start_watcher(enqueue: Optional[EnqueueFn] = None) -> None:
    global _thread, _enqueue
    if enqueue is not None:
        _enqueue = enqueue
    if _enqueue is None:
        return
    state = _load_state()
    if not state.get("enabled"):
        return
    inbox_path(state)
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="clip-inbox")
    _thread.start()


def stop_watcher() -> None:
    _stop.set()


def bind_enqueue(fn: EnqueueFn) -> None:
    global _enqueue
    _enqueue = fn
    if _load_state().get("enabled"):
        start_watcher()
