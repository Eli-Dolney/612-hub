"""Project, section, shot, and candidate records."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

CATEGORIES = ("stock", "motion", "screenshot", "overlay", "ai")
HARVEST_SKIP = {"overlay", "ai"}
ORIENTATIONS = ("any", "widescreen", "vertical", "square")
STATUSES = ("draft", "parsed", "scouting", "scouted", "pulling", "complete", "error")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(n: int = 10) -> str:
    return uuid.uuid4().hex[:n]


def slugify(value: str) -> str:
    import re

    text = value.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "untitled"


@dataclass
class Settings:
    images: bool = True
    videos: bool = True
    per_provider: int = 6
    orientation: str = "widescreen"
    min_width: int = 1280
    providers: list[str] = field(
        default_factory=lambda: ["wikimedia", "openverse", "nasa", "pexels", "pixabay", "unsplash"]
    )
    expand_queries: bool = True
    safe: bool = True
    lang: str = "en"

    def to_dict(self) -> dict[str, Any]:
        return {
            "images": self.images,
            "videos": self.videos,
            "per_provider": int(self.per_provider),
            "orientation": self.orientation if self.orientation in ORIENTATIONS else "any",
            "min_width": int(self.min_width or 0),
            "providers": list(self.providers),
            "expand_queries": self.expand_queries,
            "safe": self.safe,
            "lang": self.lang,
        }

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> "Settings":
        if not data:
            return cls()
        return cls(
            images=bool(data.get("images", True)),
            videos=bool(data.get("videos", True)),
            per_provider=int(data.get("per_provider") or data.get("images_per_provider") or 6),
            orientation=str(data.get("orientation") or "widescreen"),
            min_width=int(data.get("min_width") or 1280),
            providers=list(
                data.get("providers")
                or ["wikimedia", "openverse", "nasa", "pexels", "pixabay", "unsplash"]
            ),
            expand_queries=bool(data.get("expand_queries", True)),
            safe=bool(data.get("safe", True)),
            lang=str(data.get("lang") or "en"),
        )


@dataclass
class Shot:
    id: str
    query: str
    category: str = "stock"
    harvest: bool = True
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "query": self.query,
            "category": self.category,
            "harvest": self.harvest,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Shot":
        category = str(data.get("category") or "stock")
        if category == "motion_graphics":
            category = "motion"
        if category == "ai_broll":
            category = "ai"
        if category not in CATEGORIES:
            category = "stock"
        harvest = bool(data.get("harvest", category not in HARVEST_SKIP))
        return cls(
            id=str(data.get("id") or new_id()),
            query=str(data.get("query") or ""),
            category=category,
            harvest=harvest,
            notes=str(data.get("notes") or ""),
        )


@dataclass
class Section:
    title: str
    slug: str
    order: int
    time_start: Optional[str] = None
    time_end: Optional[str] = None
    narration: str = ""
    shots: list[Shot] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "slug": self.slug,
            "order": self.order,
            "time_start": self.time_start,
            "time_end": self.time_end,
            "narration": self.narration,
            "shots": [s.to_dict() for s in self.shots],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Section":
        return cls(
            title=str(data.get("title") or ""),
            slug=str(data.get("slug") or slugify(str(data.get("title") or "section"))),
            order=int(data.get("order") or 0),
            time_start=data.get("time_start"),
            time_end=data.get("time_end"),
            narration=str(data.get("narration") or ""),
            shots=[Shot.from_dict(s) for s in data.get("shots") or []],
        )


@dataclass
class Candidate:
    uid: str
    provider: str
    media_type: str
    id: str
    author: str = ""
    source_url: str = ""
    download_url: str = ""
    preview_url: str = ""
    play_url: str = ""
    license: str = ""
    width: int = 0
    height: int = 0
    duration: float = 0.0
    ext_hint: str = ""
    query: str = ""
    shot_id: str = ""
    section_slug: str = ""
    kept: bool = False
    pulled: bool = False
    file_path: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "uid": self.uid,
            "provider": self.provider,
            "media_type": self.media_type,
            "id": self.id,
            "author": self.author,
            "source_url": self.source_url,
            "download_url": self.download_url,
            "preview_url": self.preview_url,
            "play_url": self.play_url,
            "license": self.license,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "ext_hint": self.ext_hint,
            "query": self.query,
            "shot_id": self.shot_id,
            "section_slug": self.section_slug,
            "kept": self.kept,
            "pulled": self.pulled,
            "file_path": self.file_path,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Candidate":
        uid = str(data.get("uid") or f"{data.get('provider')}:{data.get('media_type')}:{data.get('id')}")
        return cls(
            uid=uid,
            provider=str(data.get("provider") or ""),
            media_type=str(data.get("media_type") or "images"),
            id=str(data.get("id") or ""),
            author=str(data.get("author") or ""),
            source_url=str(data.get("source_url") or ""),
            download_url=str(data.get("download_url") or ""),
            preview_url=str(data.get("preview_url") or ""),
            play_url=str(data.get("play_url") or ""),
            license=str(data.get("license") or ""),
            width=int(data.get("width") or 0),
            height=int(data.get("height") or 0),
            duration=float(data.get("duration") or 0),
            ext_hint=str(data.get("ext_hint") or ""),
            query=str(data.get("query") or ""),
            shot_id=str(data.get("shot_id") or ""),
            section_slug=str(data.get("section_slug") or ""),
            kept=bool(data.get("kept")),
            pulled=bool(data.get("pulled")),
            file_path=str(data.get("file_path") or ""),
            error=str(data.get("error") or ""),
        )


@dataclass
class Project:
    id: str
    name: str
    slug: str
    mode: str
    raw_input: str
    sections: list[Section] = field(default_factory=list)
    settings: Settings = field(default_factory=Settings)
    status: str = "draft"
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)
    error_message: str = ""
    progress: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(cls, name: str, mode: str, raw_input: str, sections: Optional[list[Section]] = None) -> "Project":
        return cls(
            id=new_id(12),
            name=name.strip() or "Untitled reel",
            slug=slugify(name) or "reel",
            mode=mode if mode in {"outline", "script"} else "outline",
            raw_input=raw_input,
            sections=sections or [],
            status="parsed",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "slug": self.slug,
            "mode": self.mode,
            "raw_input": self.raw_input,
            "sections": [s.to_dict() for s in self.sections],
            "settings": self.settings.to_dict(),
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "error_message": self.error_message,
            "progress": self.progress,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Project":
        return cls(
            id=str(data.get("id") or new_id(12)),
            name=str(data.get("name") or "Untitled reel"),
            slug=str(data.get("slug") or "reel"),
            mode=str(data.get("mode") or data.get("input_mode") or "outline"),
            raw_input=str(data.get("raw_input") or ""),
            sections=[Section.from_dict(s) for s in data.get("sections") or []],
            settings=Settings.from_dict(data.get("settings")),
            status=str(data.get("status") or "draft"),
            created_at=str(data.get("created_at") or now_iso()),
            updated_at=str(data.get("updated_at") or now_iso()),
            error_message=str(data.get("error_message") or ""),
            progress=dict(data.get("progress") or data.get("harvest_progress") or {}),
        )

    def shots(self) -> Iterable[tuple[Section, Shot]]:
        for section in self.sections:
            for shot in section.shots:
                yield section, shot

    def find_shot(self, shot_id: str) -> Optional[tuple[Section, Shot]]:
        for section, shot in self.shots():
            if shot.id == shot_id:
                return section, shot
        return None

    def harvestable(self) -> list[tuple[Section, Shot]]:
        out: list[tuple[Section, Shot]] = []
        for section, shot in self.shots():
            if shot.harvest and shot.category not in HARVEST_SKIP and shot.query.strip():
                out.append((section, shot))
        return out

    def overlay_shots(self) -> list[tuple[Section, Shot]]:
        return [(s, sh) for s, sh in self.shots() if sh.category == "overlay" and sh.query.strip()]

    def ai_shots(self) -> list[tuple[Section, Shot]]:
        return [(s, sh) for s, sh in self.shots() if sh.category == "ai" and sh.query.strip()]
