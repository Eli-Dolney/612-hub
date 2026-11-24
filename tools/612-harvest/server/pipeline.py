"""Create reels, scout providers, keep clips, pull files."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from server.config import PROJECTS_DIR, load_config, mask_secret
from server.engine.credits import write_credits
from server.engine.io_util import (
    delete_project,
    dest_for,
    download_file,
    list_project_files,
    load_candidates,
    load_project,
    merge_candidates,
    project_dir,
    save_candidates,
    save_project,
    unique_slug,
    write_manifest,
)
from server.engine.models import Candidate, Project, Settings, Shot, new_id, now_iso
from server.engine.outline import parse_outline
from server.engine.providers.base import SearchSpec
from server.engine.providers.registry import build_providers, provider_status
from server.engine.queries import expand_query
from server.engine.resolve_xml import write_fcpxml
from server.engine.script import parse_script

ProgressFn = Callable[[float, str], None]


def health() -> dict[str, Any]:
    cfg = load_config()
    providers = provider_status()
    return {
        "ok": True,
        "app": "612 Harvest",
        "version": "1.0.0",
        "zero_key": [p["name"] for p in providers if p["zero_key"]],
        "providers": providers,
        "projects": len(list_summaries()),
        "output_dir": str(PROJECTS_DIR),
        "keys": {
            "pexels": bool((cfg.get("providers") or {}).get("pexels", {}).get("api_key")),
            "pixabay": bool((cfg.get("providers") or {}).get("pixabay", {}).get("api_key")),
            "unsplash": bool((cfg.get("providers") or {}).get("unsplash", {}).get("access_key")),
        },
    }


def list_summaries() -> list[dict[str, Any]]:
    if not PROJECTS_DIR.exists():
        return []
    rows: list[dict[str, Any]] = []
    for folder in sorted(PROJECTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if folder.is_dir() and (folder / "project.json").exists():
            try:
                rows.append(summary(folder.name))
            except Exception:
                continue
    return rows


def summary(slug: str) -> dict[str, Any]:
    project = load_project(slug)
    rows = load_candidates(slug)
    harvestable = project.harvestable()
    kept = [r for r in rows if r.kept]
    pulled = [r for r in rows if r.pulled]
    return {
        "id": project.id,
        "name": project.name,
        "slug": project.slug,
        "mode": project.mode,
        "status": project.status,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "sections": len(project.sections),
        "shots": sum(len(s.shots) for s in project.sections),
        "harvestable": len(harvestable),
        "scouted": len(rows),
        "kept": len(kept),
        "pulled": len(pulled),
        "error_message": project.error_message,
        "progress": project.progress,
    }


def detail(slug: str) -> dict[str, Any]:
    project = load_project(slug)
    rows = load_candidates(slug)
    data = project.to_dict()
    data["candidates"] = [r.to_dict() for r in rows]
    data["summary"] = summary(slug)
    data["credits"] = write_credits(project, rows)
    data["files"] = list_project_files(slug)
    data["ai"] = [{"section": s.title, "query": sh.query} for s, sh in project.ai_shots()]
    data["overlays"] = [{"section": s.title, "query": sh.query} for s, sh in project.overlay_shots()]
    return data


def create_from_text(text: str, name: str, mode: str) -> dict[str, Any]:
    if not text.strip():
        raise ValueError("Paste an outline or script first")
    project = parse_script(text, name) if mode == "script" else parse_outline(text, name)
    project.slug = unique_slug(name or project.name)
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    save_project(project)
    save_candidates(project.slug, [])
    return detail(project.slug)


def patch_project(slug: str, payload: dict[str, Any]) -> dict[str, Any]:
    project = load_project(slug)
    if payload.get("name"):
        project.name = str(payload["name"]).strip()
    if payload.get("settings"):
        project.settings = Settings.from_dict(payload["settings"])
    if payload.get("sections") is not None:
        from server.engine.models import Section

        project.sections = [Section.from_dict(s) for s in payload["sections"]]
        for section in project.sections:
            for shot in section.shots:
                if not shot.id:
                    shot.id = new_id()
    project.updated_at = now_iso()
    save_project(project)
    return detail(slug)


def add_shot(slug: str, section_slug: str, query: str, category: str = "stock") -> dict[str, Any]:
    project = load_project(slug)
    for section in project.sections:
        if section.slug == section_slug:
            section.shots.append(
                Shot(id=new_id(), query=query.strip(), category=category, harvest=category not in {"overlay", "ai"})
            )
            save_project(project)
            return detail(slug)
    raise FileNotFoundError(section_slug)


def remove_project(slug: str) -> None:
    delete_project(slug)


def _spec_for(project: Project, query: str) -> SearchSpec:
    settings = project.settings
    return SearchSpec(
        query=query,
        per_page=max(2, min(settings.per_provider, 12)),
        images=settings.images,
        videos=settings.videos,
        orientation=settings.orientation,
        min_width=settings.min_width,
        safe=settings.safe,
        lang=settings.lang,
    )


def scout_project(slug: str, shot_id: Optional[str] = None, progress: Optional[ProgressFn] = None) -> dict[str, Any]:
    emit = progress or (lambda *_: None)
    project = load_project(slug)
    targets = project.harvestable()
    if shot_id:
        found = project.find_shot(shot_id)
        if not found:
            raise FileNotFoundError(shot_id)
        targets = [found]
    if not targets:
        raise RuntimeError("No harvestable shots. Add visuals or enable harvest on a shot.")

    providers = build_providers(project.settings.providers)
    if not providers:
        raise RuntimeError("No providers available. Wikimedia / Openverse / NASA should work with no keys.")

    project.status = "scouting"
    project.error_message = ""
    save_project(project)
    existing = load_candidates(slug)
    incoming: list[Candidate] = []
    total = max(1, len(targets))

    for index, (section, shot) in enumerate(targets):
        queries = expand_query(shot.query, project.settings.expand_queries)
        emit((index / total), f"{section.title} · {shot.query}")
        for query in queries:
            for client in providers:
                try:
                    rows = client.search(_spec_for(project, query))
                except Exception as exc:  # noqa: BLE001
                    emit((index + 0.5) / total, f"{client.name} skipped: {exc}")
                    continue
                for row in rows:
                    row.query = query
                    row.shot_id = shot.id
                    row.section_slug = section.slug
                    incoming.append(row)

    merged = merge_candidates(existing, incoming)
    save_candidates(slug, merged)
    project = load_project(slug)
    project.status = "scouted"
    project.progress = {"scouted": len(merged), "shots": len(targets)}
    save_project(project)
    emit(1.0, f"{len(incoming)} new previews")
    return detail(slug)


def set_kept(slug: str, uids: list[str], kept: bool) -> dict[str, Any]:
    rows = load_candidates(slug)
    wanted = set(uids)
    for row in rows:
        if row.uid in wanted:
            row.kept = kept
    save_candidates(slug, rows)
    return detail(slug)


def keep_best(slug: str, shot_id: str, count: int = 3) -> dict[str, Any]:
    rows = load_candidates(slug)
    pool = [r for r in rows if r.shot_id == shot_id]
    ranked = sorted(pool, key=lambda r: (r.media_type != "videos", -(r.width * r.height), r.provider))
    chosen = {r.uid for r in ranked[: max(1, count)]}
    for row in rows:
        if row.shot_id == shot_id:
            row.kept = row.uid in chosen or row.kept
    save_candidates(slug, rows)
    return detail(slug)


def pull_project(slug: str, keepers_only: bool = True, progress: Optional[ProgressFn] = None) -> dict[str, Any]:
    emit = progress or (lambda *_: None)
    project = load_project(slug)
    rows = load_candidates(slug)
    targets = [r for r in rows if (r.kept if keepers_only else True) and r.download_url]
    if keepers_only and not targets:
        raise RuntimeError("Keep some clips in the mosaic first, then Pull keepers.")
    if not targets:
        raise RuntimeError("Scout first so there is something to download.")

    project.status = "pulling"
    save_project(project)
    total = max(1, len(targets))
    done = 0
    for row in targets:
        emit(done / total, f"{row.provider} · {row.query}")
        if row.pulled and row.file_path and Path(row.file_path).is_file():
            done += 1
            continue
        dest = dest_for(slug, row)
        try:
            saved = download_file(row.download_url, dest)
            row.pulled = True
            row.file_path = str(Path(saved).resolve().relative_to(project_dir(slug).resolve()))
            row.error = ""
        except Exception as exc:  # noqa: BLE001
            row.error = str(exc)
        done += 1
        save_candidates(slug, rows)

    write_manifest(slug, rows)
    write_credits(project, rows)
    write_fcpxml(project, rows)
    project = load_project(slug)
    project.status = "complete"
    project.progress = {
        "pulled": len([r for r in rows if r.pulled]),
        "failed": len([r for r in rows if r.error]),
        "kept": len([r for r in rows if r.kept]),
    }
    save_project(project)
    emit(1.0, "Bin ready")
    return detail(slug)


def open_folder(slug: str) -> str:
    path = project_dir(slug)
    if not path.exists():
        raise FileNotFoundError(slug)
    if os.name == "nt":
        os.startfile(str(path))
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])
    return str(path)


def public_config() -> dict[str, Any]:
    cfg = load_config()
    providers = cfg.get("providers") or {}
    return {
        "output_dir": str(PROJECTS_DIR),
        "providers": {
            "pexels": mask_secret((providers.get("pexels") or {}).get("api_key")),
            "pixabay": mask_secret((providers.get("pixabay") or {}).get("api_key")),
            "unsplash": mask_secret((providers.get("unsplash") or {}).get("access_key")),
        },
        "status": provider_status(),
    }
