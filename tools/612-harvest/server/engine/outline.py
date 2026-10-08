"""Parse timestamped visual outlines into a reel."""

from __future__ import annotations

import re
from typing import Optional

from server.engine.models import HARVEST_SKIP, Project, Section, Shot, new_id, slugify

SECTION_HEADER = re.compile(r"^(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s+(.+)$")

BLOCK_HEADERS = {
    "search": "stock",
    "b-roll": "stock",
    "b roll": "stock",
    "visuals": "stock",
    "use": "stock",
    "show": "stock",
    "layer 1": "stock",
    "layer 2": "screenshot",
    "layer 3": "motion",
    "motion graphics": "motion",
    "motion graphic": "motion",
    "ai clips": "ai",
    "ai clips you can generate": "ai",
    "ai images": "ai",
    "ai generated": "ai",
    "on-screen text": "overlay",
    "on screen text": "overlay",
    "text overlays": "overlay",
    "text": "overlay",
    "narration": None,
    "phase 1": "stock",
    "phase 2": "stock",
    "phase 3": "stock",
    "phase 4": "motion",
    "phase 5": "stock",
}


def _block_key(line: str) -> Optional[str]:
    cleaned = line.strip().rstrip(":").lower()
    if cleaned in BLOCK_HEADERS:
        return cleaned
    for key in sorted(BLOCK_HEADERS, key=len, reverse=True):
        if cleaned == key or cleaned.startswith(key + ":"):
            return key
    return None


def _is_bullet(line: str) -> bool:
    return bool(re.match(r"^[\-\*•]\s+", line.strip()))


def _strip_bullet(line: str) -> str:
    return re.sub(r"^[\-\*•]\s+", "", line.strip()).strip()


def _category_for(text: str, current: str) -> str:
    if current in HARVEST_SKIP:
        return current
    lower = text.lower()
    if any(k in lower for k in ["map", "chart", "timeline", "infographic", "animation", "graph", "diagram"]):
        return "motion"
    if any(k in lower for k in ["headline", "screenshot", "lower third", "lockdown"]):
        return "screenshot"
    return current


def parse_outline(text: str, project_name: str = "Untitled reel") -> Project:
    lines = text.splitlines()
    sections: list[Section] = []
    current: Optional[Section] = None
    category = "stock"
    narration: list[str] = []
    in_narration = False
    order = 0

    def flush_narration() -> None:
        nonlocal narration, in_narration
        if current and narration:
            current.narration = " ".join(narration).strip()
        narration = []
        in_narration = False

    def add_shot(query: str, cat: Optional[str] = None) -> None:
        if not current:
            return
        q = query.strip().strip('"').strip("'")
        if len(q) < 2:
            return
        chosen = _category_for(q, cat or category)
        current.shots.append(
            Shot(id=new_id(), query=q, category=chosen, harvest=chosen not in HARVEST_SKIP)
        )

    for raw in lines:
        line = raw.strip()
        if not line:
            if in_narration:
                flush_narration()
            continue

        header = SECTION_HEADER.match(line)
        if header:
            flush_narration()
            order += 1
            start, end, title = header.groups()
            current = Section(
                title=title.strip(),
                slug=f"{order:02d}_{slugify(title.strip())}",
                order=order,
                time_start=start,
                time_end=end,
            )
            sections.append(current)
            category = "stock"
            continue

        key = _block_key(line)
        if key is not None:
            flush_narration()
            block = BLOCK_HEADERS[key]
            if block is None:
                in_narration = True
                after = line.split(":", 1)
                if len(after) > 1 and after[1].strip():
                    narration.append(after[1].strip())
                continue
            category = block
            inline = line.split(":", 1)
            if len(inline) > 1 and inline[1].strip() and not _is_bullet(inline[1]):
                add_shot(inline[1].strip())
            continue

        if in_narration:
            narration.append(line.strip('"'))
            continue

        if _is_bullet(line):
            add_shot(_strip_bullet(line))
            continue

        if line.isupper() and len(line.split()) <= 8:
            add_shot(line, "overlay")
            continue

        if current and len(line.split()) <= 6:
            add_shot(line)

    flush_narration()
    if not sections:
        sections = _fallback(text)
    return Project.create(project_name, "outline", text, sections)


def _fallback(text: str) -> list[Section]:
    section = Section(title="Main", slug="01_main", order=1)
    category = "stock"
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        key = _block_key(line)
        if key is not None:
            cat = BLOCK_HEADERS.get(key)
            if cat:
                category = cat
            continue
        if _is_bullet(line):
            q = _strip_bullet(line)
            if q:
                chosen = _category_for(q, category)
                section.shots.append(
                    Shot(id=new_id(), query=q, category=chosen, harvest=chosen not in HARVEST_SKIP)
                )
    return [section]
