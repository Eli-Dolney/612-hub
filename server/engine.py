"""Detect, launch, stop, and health-check Grok apps on this Mac."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from server.catalog import APPS, AppSpec, get_app
from server.config import DESKTOP, LOGS, PREFS_PATH

for _bin in ("/opt/homebrew/bin", "/usr/local/bin"):
    if _bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

_launched: dict[str, int] = {}
OPENED_PATH = LOGS / "opened.json"
SOFT_LIVE = 2
HARD_LIVE = 3
CPU_BUSY = 160.0
CPU_FULL = 280.0
MEDIA_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".mp3", ".m4a", ".wav", ".flac", ".opus", ".aac"}
DEFAULT_PREFS = {
    "auto_open": False,
    "auto_open_seeded": False,
    "opened_jobs": [],
}


def _http_ok(url: str, timeout: float = 0.8) -> bool:
    try:
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except Exception:
        return False


def pids_on_port(port: int) -> list[int]:
    lsof = shutil.which("lsof")
    if not lsof:
        return []
    result = subprocess.run(
        [lsof, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        capture_output=True,
        text=True,
    )
    found: list[int] = []
    for line in (result.stdout or "").strip().splitlines():
        try:
            found.append(int(line))
        except ValueError:
            continue
    return found


def pid_on_port(port: int) -> Optional[int]:
    found = pids_on_port(port)
    return found[0] if found else None


def _ps_table() -> list[tuple[int, int, float, int]]:
    result = subprocess.run(
        ["ps", "-ax", "-o", "pid=,ppid=,pcpu=,rss="],
        capture_output=True,
        text=True,
    )
    rows: list[tuple[int, int, float, int]] = []
    for line in (result.stdout or "").splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            rows.append((int(parts[0]), int(parts[1]), float(parts[2]), int(parts[3])))
        except ValueError:
            continue
    return rows


def _tree_stats(roots: list[int], table: list[tuple[int, int, float, int]]) -> tuple[float, float]:
    if not roots:
        return 0.0, 0.0
    kids: dict[int, list[int]] = defaultdict(list)
    info: dict[int, tuple[float, int]] = {}
    for pid, ppid, cpu, rss in table:
        kids[ppid].append(pid)
        info[pid] = (cpu, rss)
    seen: set[int] = set()
    stack = list(roots)
    cpu = 0.0
    rss = 0
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        if pid in info:
            cpu += info[pid][0]
            rss += info[pid][1]
        stack.extend(kids.get(pid, []))
    return cpu, rss / 1024.0


def _opened() -> dict[str, str]:
    try:
        data = json.loads(OPENED_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def touch_opened(app_id: str) -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    data = _opened()
    data[app_id] = datetime.now(timezone.utc).isoformat()
    OPENED_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _idle_s(app_id: str) -> Optional[int]:
    raw = _opened().get(app_id)
    if not raw:
        return None
    try:
        then = datetime.fromisoformat(raw)
        return max(0, int((datetime.now(timezone.utc) - then).total_seconds()))
    except Exception:
        return None


def spec_pids(spec: AppSpec) -> list[int]:
    pids = pids_on_port(spec.ui_port)
    if spec.api_port:
        pids.extend(pids_on_port(spec.api_port))
    return list(dict.fromkeys(pids))


def load_report(apps: list[dict[str, Any]]) -> dict[str, Any]:
    live_apps = [a for a in apps if a.get("running")]
    cpu = sum(float(a.get("cpu") or 0) for a in live_apps)
    rss = sum(float(a.get("rss_mb") or 0) for a in live_apps)
    n = len(live_apps)
    heaviest = max(live_apps, key=lambda a: float(a.get("cpu") or 0), default=None)
    if n >= HARD_LIVE or cpu >= CPU_FULL:
        level = "full"
    elif n >= SOFT_LIVE or cpu >= CPU_BUSY:
        level = "busy"
    else:
        level = "ok"
    hint = ""
    if heaviest and level != "ok":
        name = heaviest.get("name") or heaviest.get("id")
        hint = (
            f"{n} live · Grok {cpu:.0f}% CPU · {rss:.0f} MB. "
            f"Stop {name} ({float(heaviest.get('cpu') or 0):.0f}% CPU) before opening another."
        )
    elif n:
        hint = f"{n} live · Grok {cpu:.0f}% CPU · {rss:.0f} MB. Two Vite apps at once is the sweet spot."
    else:
        hint = "No Grok apps live. Launch one from Studio."
    return {
        "live": n,
        "recommend": SOFT_LIVE,
        "max": HARD_LIVE,
        "cpu": round(cpu, 0),
        "rss_mb": round(rss, 0),
        "level": level,
        "block_launch": level == "full",
        "hint": hint,
        "heaviest": heaviest.get("id") if heaviest else None,
    }


def installed(spec: AppSpec) -> bool:
    return spec.path.is_dir() and (spec.path / "package.json").is_file()


def configured(spec: AppSpec) -> bool:
    if not installed(spec):
        return False
    has_ui = (spec.path / "node_modules").is_dir()
    if spec.launch == "run.sh":
        return has_ui and (spec.path / ".venv" / "bin" / "python").is_file()
    return has_ui


def live(spec: AppSpec) -> bool:
    """UI origin is what the browser opens. For API apps, Vite proxies /api."""
    path = spec.health_path if spec.health_path else "/"
    return _http_ok(f"http://127.0.0.1:{spec.ui_port}{path}")


def fetch_json(url: str, timeout: float = 0.6) -> Any:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def app_status(spec: AppSpec, table: Optional[list[tuple[int, int, float, int]]] = None) -> dict[str, Any]:
    exists = installed(spec)
    running = live(spec) if exists else False
    roots = spec_pids(spec)
    pid = roots[0] if roots else None
    cpu, rss_mb = _tree_stats(roots, table or []) if roots else (0.0, 0.0)
    jobs = []
    health = None
    if running and spec.api_port:
        health = fetch_json(f"http://127.0.0.1:{spec.api_port}/api/health")
        queue = fetch_json(f"http://127.0.0.1:{spec.api_port}/api/queue")
        if isinstance(queue, dict) and isinstance(queue.get("jobs"), list):
            jobs = queue["jobs"][:8]
    recent = recent_work(spec) if exists else []
    idle = _idle_s(spec.id) if running else None
    return {
        **spec.as_dict(),
        "installed": exists,
        "configured": configured(spec) if exists else False,
        "running": running,
        "pid": pid,
        "cpu": round(cpu, 0),
        "rss_mb": round(rss_mb, 0),
        "idle_s": idle,
        "launched_by_hub": spec.id in _launched,
        "health": health,
        "jobs": jobs,
        "recent": recent,
    }


def recent_work(spec: AppSpec, limit: int = 5) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for rel in spec.projects:
        folder = spec.path / rel
        if not folder.is_dir():
            continue
        children = [p for p in folder.iterdir() if not p.name.startswith(".")]
        children.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for path in children[:limit]:
            stat = path.stat()
            rows.append(
                {
                    "app": spec.id,
                    "name": path.name,
                    "path": str(path),
                    "kind": "dir" if path.is_dir() else "file",
                    "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "size": stat.st_size if path.is_file() else None,
                }
            )
    rows.sort(key=lambda r: r["mtime"], reverse=True)
    return rows[:limit]


def load_prefs() -> dict[str, Any]:
    data = dict(DEFAULT_PREFS)
    try:
        raw = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            data.update(raw)
    except Exception:
        pass
    return data


def save_prefs(prefs: dict[str, Any]) -> dict[str, Any]:
    LOGS.mkdir(parents=True, exist_ok=True)
    merged = {**DEFAULT_PREFS, **prefs}
    opened = merged.get("opened_jobs") or []
    if isinstance(opened, list):
        merged["opened_jobs"] = opened[-200:]
    PREFS_PATH.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    return merged


def patch_prefs(fields: dict[str, Any]) -> dict[str, Any]:
    prefs = load_prefs()
    if "auto_open" in fields:
        turning_on = bool(fields["auto_open"]) and not prefs.get("auto_open")
        prefs["auto_open"] = bool(fields["auto_open"])
        if turning_on:
            prefs["auto_open_seeded"] = False
    return save_prefs(prefs)


def maybe_auto_open(jobs: list[dict[str, Any]]) -> None:
    prefs = load_prefs()
    if not prefs.get("auto_open"):
        return
    seen = set(prefs.get("opened_jobs") or [])
    if not prefs.get("auto_open_seeded"):
        for job in jobs:
            if job.get("status") == "done" and job.get("id"):
                seen.add(f"{job.get('app')}:{job['id']}")
        prefs["auto_open_seeded"] = True
        prefs["opened_jobs"] = list(seen)
        save_prefs(prefs)
        return
    changed = False
    for job in jobs:
        if job.get("status") != "done" or not job.get("id"):
            continue
        jid = f"{job.get('app')}:{job['id']}"
        if jid in seen:
            continue
        target = job.get("filename") or job.get("folder")
        if target:
            try:
                open_path(str(target))
            except Exception:
                pass
        seen.add(jid)
        changed = True
    if changed:
        prefs["opened_jobs"] = list(seen)
        save_prefs(prefs)


def _media_row(
    *,
    app: str,
    app_name: str,
    title: str,
    path: Path,
    folder: Path,
    kind: str,
) -> Optional[dict[str, Any]]:
    if not path.exists():
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    return {
        "id": f"{app}:{path}",
        "app": app,
        "app_name": app_name,
        "title": title,
        "path": str(path),
        "folder": str(folder),
        "kind": kind,
        "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "size": stat.st_size if path.is_file() else None,
    }


def list_media(limit: int = 120) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in APPS:
        if not installed(spec):
            continue
        if spec.id == "clip":
            root = spec.path / "projects"
            if not root.is_dir():
                continue
            for project in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                if not project.is_dir() or project.name.startswith("."):
                    continue
                bundle = project / "bundle"
                primary = bundle / "primary.mp4"
                row = _media_row(
                    app=spec.id,
                    app_name=spec.name,
                    title=f"{project.name} · bundle",
                    path=primary if primary.is_file() else bundle if bundle.is_dir() else project,
                    folder=bundle if bundle.is_dir() else project,
                    kind="bundle" if primary.is_file() or bundle.is_dir() else "project",
                )
                if row:
                    rows.append(row)
                clips_dir = bundle / "clips"
                if clips_dir.is_dir():
                    for clip in sorted(clips_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                        if clip.suffix.lower() not in MEDIA_EXTS:
                            continue
                        crow = _media_row(
                            app=spec.id,
                            app_name=spec.name,
                            title=f"{project.name} · {clip.name}",
                            path=clip,
                            folder=clips_dir,
                            kind="clip",
                        )
                        if crow:
                            rows.append(crow)
        elif spec.id == "pull":
            for rel in spec.projects:
                folder = spec.path / rel
                if not folder.is_dir():
                    continue
                for dirpath, dirnames, filenames in os.walk(folder):
                    dirnames[:] = [d for d in dirnames if not d.startswith(".")]
                    for name in filenames:
                        path = Path(dirpath) / name
                        if path.suffix.lower() not in MEDIA_EXTS:
                            continue
                        row = _media_row(
                            app=spec.id,
                            app_name=spec.name,
                            title=name,
                            path=path,
                            folder=Path(dirpath),
                            kind="download",
                        )
                        if row:
                            rows.append(row)
    rows.sort(key=lambda r: r["mtime"], reverse=True)
    return rows[:limit]


def delete_media(path: str) -> dict[str, Any]:
    target = Path(path).expanduser().resolve()
    allowed = False
    for spec in APPS:
        if not installed(spec):
            continue
        for rel in spec.projects:
            root = (spec.path / rel).resolve()
            try:
                target.relative_to(root)
                allowed = True
                break
            except ValueError:
                continue
        if allowed:
            break
    if not allowed:
        raise PermissionError("Path is outside Grok media folders")
    if not target.exists():
        raise FileNotFoundError(path)
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
        parent = target.parent
        # Drop empty clip folders after last file.
        if parent.name == "clips" and parent.is_dir() and not any(parent.iterdir()):
            try:
                parent.rmdir()
            except OSError:
                pass
    return {"ok": True, "path": str(target)}


def snapshot() -> dict[str, Any]:
    table = _ps_table()
    apps = [app_status(spec, table) for spec in APPS]
    jobs: list[dict[str, Any]] = []
    for app in apps:
        for job in app.get("jobs") or []:
            if isinstance(job, dict):
                jobs.append({**job, "app": app["id"], "app_name": app["name"]})
    maybe_auto_open(jobs)
    recent: list[dict[str, Any]] = []
    for spec in APPS:
        recent.extend(recent_work(spec, 3))
    recent.sort(key=lambda r: r["mtime"], reverse=True)
    load = load_report(apps)
    prefs = load_prefs()
    return {
        "apps": apps,
        "jobs": jobs[:20],
        "recent": recent[:12],
        "running": load["live"],
        "installed": sum(1 for a in apps if a["installed"]),
        "desktop": str(DESKTOP),
        "load": load,
        "prefs": {"auto_open": bool(prefs.get("auto_open"))},
    }


def requirements() -> list[dict[str, Any]]:
    def which_ver(cmd: str, args: list[str]) -> tuple[bool, str]:
        bin_path = shutil.which(cmd)
        if not bin_path:
            return False, ""
        result = subprocess.run([bin_path, *args], capture_output=True, text=True)
        text = (result.stdout or result.stderr or bin_path).strip().splitlines()
        return True, text[0] if text else bin_path

    py_ok, py_ver = which_ver("python3.12", ["--version"])
    if not py_ok:
        py_ok, py_ver = which_ver("python3", ["--version"])
    node_ok, node_ver = which_ver("node", ["--version"])
    ff_ok, ff_ver = which_ver("ffmpeg", ["-version"])
    git_ok, git_ver = which_ver("git", ["--version"])
    return [
        {"id": "python", "name": "Python 3.12+", "available": py_ok, "version": py_ver, "need": "Most Grok apps"},
        {"id": "node", "name": "Node.js 18+", "available": node_ok, "version": node_ver, "need": "Every Grok UI"},
        {"id": "ffmpeg", "name": "FFmpeg", "available": ff_ok, "version": ff_ver, "need": "Pull, Mix, Clip, Voice"},
        {"id": "git", "name": "Git", "available": git_ok, "version": git_ver, "need": "Optional"},
    ]


def _cmd(spec: AppSpec) -> list[str]:
    if spec.launch == "run.sh":
        script = spec.path / "run.sh"
        return ["/bin/bash", str(script)]
    npm = shutil.which("npm") or "npm"
    return [npm, "run", "dev"]


def launch(app_id: str, *, force: bool = False) -> dict[str, Any]:
    spec = get_app(app_id)
    if not installed(spec):
        raise FileNotFoundError(f"{spec.name} is not on the Desktop ({spec.path})")
    if live(spec):
        touch_opened(app_id)
        open_url(spec.url)
        return {"ok": True, "message": f"{spec.name} is already running", "url": spec.url, "started": False}
    table = _ps_table()
    apps = [app_status(s, table) for s in APPS]
    load = load_report(apps)
    if load["block_launch"] and not force:
        raise RuntimeError(load["hint"] + " Use Stop on a live app, then launch.")
    # Port taken but not answering 127.0.0.1 (IPv6-only Vite, hung process, leftover).
    occupied = spec_pids(spec)
    if occupied:
        stop(app_id)
        time.sleep(0.5)

    LOGS.mkdir(parents=True, exist_ok=True)
    log = (LOGS / f"{spec.id}.log").open("ab")
    env = os.environ.copy()
    cmd = _cmd(spec)
    if spec.launch == "run.sh" and not (spec.path / "run.sh").is_file():
        cmd = [shutil.which("npm") or "npm", "run", "dev"]
    proc = subprocess.Popen(
        cmd,
        cwd=str(spec.path),
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        env=env,
    )
    _launched[spec.id] = proc.pid
    touch_opened(app_id)
    threading.Thread(target=_wait_and_open, args=(spec, proc), daemon=True).start()
    return {
        "ok": True,
        "message": f"Starting {spec.name}",
        "url": spec.url,
        "started": True,
        "pid": proc.pid,
    }


def _wait_and_open(spec: AppSpec, proc: subprocess.Popen) -> None:
    deadline = time.time() + 90
    while time.time() < deadline:
        if live(spec):
            open_url(spec.url)
            return
        if proc.poll() is not None:
            return
        time.sleep(0.4)


def stop(app_id: str) -> dict[str, Any]:
    spec = get_app(app_id)
    pids: set[int] = set()
    launched = _launched.get(spec.id)
    if launched:
        pids.add(launched)
    for port in (spec.ui_port, spec.api_port):
        if not port:
            continue
        pids.update(pids_on_port(port))
    if not pids:
        return {"ok": True, "message": f"{spec.name} is not running"}
    for pid in pids:
        _kill_tree(pid)
    _launched.pop(spec.id, None)
    return {"ok": True, "message": f"Stopped {spec.name}"}


def stop_others(keep: Optional[str] = None) -> dict[str, Any]:
    stopped: list[str] = []
    for spec in APPS:
        if keep and spec.id == keep:
            continue
        if live(spec) or spec_pids(spec):
            stop(spec.id)
            stopped.append(spec.name)
    hint = f"Stopped {', '.join(stopped)}" if stopped else "Nothing else was running"
    return {"ok": True, "message": hint, "stopped": stopped}


def _kill_tree(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    except PermissionError:
        subprocess.run(["kill", str(pid)], capture_output=True)


def open_url(url: str) -> None:
    subprocess.Popen(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def open_app(app_id: str) -> dict[str, Any]:
    spec = get_app(app_id)
    if not live(spec):
        return launch(app_id)
    touch_opened(app_id)
    open_url(spec.url)
    return {"ok": True, "url": spec.url, "message": f"Opened {spec.name}"}


def open_path(path: str) -> None:
    target = Path(path).expanduser()
    if not target.exists():
        raise FileNotFoundError(path)
    subprocess.Popen(["open", str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def reveal(path: str, *, in_finder: bool = False) -> None:
    target = Path(path).expanduser()
    if not target.exists():
        raise FileNotFoundError(path)
    if in_finder and target.is_file():
        subprocess.Popen(["open", "-R", str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    open_path(str(target))
