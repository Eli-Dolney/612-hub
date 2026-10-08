"""Filesystem helpers, downloads, and project folders."""

from __future__ import annotations

import csv
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests

from server.config import PROJECTS_DIR, USER_AGENT, load_config
from server.engine.models import Candidate, Project, now_iso, slugify

MANIFEST_FIELDS = [
    "uid",
    "query",
    "provider",
    "media_type",
    "id",
    "author",
    "source_url",
    "license",
    "width",
    "height",
    "section",
    "shot_id",
    "file_path",
]


def session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    s.headers["Accept"] = "*/*"
    return s


HTTP = session()


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def project_dir(slug: str) -> Path:
    return PROJECTS_DIR / slug


def unique_slug(name: str) -> str:
    base = slugify(name) or "reel"
    candidate = base
    n = 2
    while (PROJECTS_DIR / candidate).exists():
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def guess_ext(url: str, hint: str = "", content_type: str = "") -> str:
    if hint and hint.startswith("."):
        return hint
    if hint:
        return f".{hint.lstrip('.')}"
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
        "image/tiff": ".tif",
    }
    if content_type:
        ext = mapping.get(content_type.split(";")[0].strip())
        if ext:
            return ext
    path = urlparse(url).path.lower()
    match = re.search(r"\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|ogv|mkv)(?:$|\?)", path)
    if match:
        ext = match.group(1)
        return ".jpg" if ext == "jpeg" else f".{ext}"
    return ".bin"


def save_project(project: Project) -> Path:
    root = ensure_dir(project_dir(project.slug))
    project.updated_at = now_iso()
    (root / "project.json").write_text(json.dumps(project.to_dict(), indent=2) + "\n", encoding="utf-8")
    write_shotlists(project, root)
    return root


def load_project(slug: str) -> Project:
    path = project_dir(slug) / "project.json"
    if not path.is_file():
        raise FileNotFoundError(slug)
    return Project.from_dict(json.loads(path.read_text(encoding="utf-8")))


def load_candidates(slug: str) -> list[Candidate]:
    path = project_dir(slug) / "scout.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Candidate.from_dict(row) for row in data]


def save_candidates(slug: str, rows: list[Candidate]) -> None:
    root = ensure_dir(project_dir(slug))
    payload = [row.to_dict() for row in rows]
    (root / "scout.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def merge_candidates(existing: list[Candidate], incoming: list[Candidate]) -> list[Candidate]:
    kept = {row.uid: row for row in existing}
    out: list[Candidate] = []
    seen: set[str] = set()
    for row in incoming + existing:
        if row.uid in seen:
            continue
        seen.add(row.uid)
        prev = kept.get(row.uid)
        if prev:
            row.kept = prev.kept or row.kept
            row.pulled = prev.pulled or row.pulled
            row.file_path = row.file_path or prev.file_path
        out.append(row)
    return out


def write_shotlists(project: Project, root: Path) -> None:
    ai = ["# AI B-roll to generate yourself", ""]
    overlays = ["# On-screen text", ""]
    for section, shot in project.ai_shots():
        ai.append(f"- **{section.title}** — {shot.query}")
    for section, shot in project.overlay_shots():
        overlays.append(f"- **{section.title}** — {shot.query}")
    if len(ai) == 2:
        ai.append("_None detected._")
    if len(overlays) == 2:
        overlays.append("_None detected._")
    (root / "shotlist_ai.md").write_text("\n".join(ai) + "\n", encoding="utf-8")
    (root / "text_overlays.md").write_text("\n".join(overlays) + "\n", encoding="utf-8")


def write_manifest(slug: str, rows: list[Candidate]) -> Path:
    root = ensure_dir(project_dir(slug))
    path = root / "manifest.csv"
    pulled = [r for r in rows if r.pulled and r.file_path]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=MANIFEST_FIELDS)
        writer.writeheader()
        for row in pulled:
            writer.writerow(
                {
                    "uid": row.uid,
                    "query": row.query,
                    "provider": row.provider,
                    "media_type": row.media_type,
                    "id": row.id,
                    "author": row.author,
                    "source_url": row.source_url,
                    "license": row.license,
                    "width": row.width,
                    "height": row.height,
                    "section": row.section_slug,
                    "shot_id": row.shot_id,
                    "file_path": row.file_path,
                }
            )
    return path


def dest_for(slug: str, row: Candidate) -> Path:
    kind = "videos" if row.media_type == "videos" else "images"
    folder = ensure_dir(project_dir(slug) / "bins" / (row.section_slug or "bin") / kind / slugify(row.query or "clip"))
    ext = guess_ext(row.download_url, row.ext_hint)
    name = f"{slugify(row.provider)}_{slugify(row.id)}{ext}"
    return folder / name


def download_file(url: str, dest: Path, headers: Optional[dict[str, str]] = None) -> Path:
    cfg = load_config()
    timeout = int(cfg.get("defaults", {}).get("timeout_sec", 30))
    retries = int(cfg.get("defaults", {}).get("retries", 2))
    ensure_dir(dest.parent)
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            with HTTP.get(url, stream=True, timeout=timeout, headers=headers or {}, allow_redirects=True) as response:
                response.raise_for_status()
                fd, tmp = tempfile.mkstemp(prefix="gh_", suffix=".part", dir=str(dest.parent))
                try:
                    with os.fdopen(fd, "wb") as handle:
                        for chunk in response.iter_content(chunk_size=64 * 1024):
                            if chunk:
                                handle.write(chunk)
                    os.replace(tmp, dest)
                finally:
                    if os.path.exists(tmp):
                        os.remove(tmp)
            return dest
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < retries:
                time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"download failed: {last_error}")


def delete_project(slug: str) -> None:
    path = project_dir(slug).resolve()
    root = PROJECTS_DIR.resolve()
    if path == root or root not in path.parents:
        raise ValueError("invalid project path")
    if path.exists():
        shutil.rmtree(path)


def list_project_files(slug: str) -> list[dict[str, Any]]:
    root = project_dir(slug)
    if not root.is_dir():
        return []
    files: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".ogv"}:
            files.append(
                {
                    "rel": str(path.relative_to(root)),
                    "name": path.name,
                    "bytes": path.stat().st_size,
                }
            )
    return files


def resolve_media(slug: str, rel: str) -> Path:
    root = project_dir(slug).resolve()
    target = (root / rel).resolve()
    if root not in target.parents and target != root:
        raise ValueError("path escapes project")
    if not target.is_file():
        raise FileNotFoundError(rel)
    return target
