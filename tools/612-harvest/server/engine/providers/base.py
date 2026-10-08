"""Shared provider types and orientation filters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from server.engine.models import Candidate


def orientation_ok(width: int, height: int, orientation: str) -> bool:
    if not orientation or orientation == "any" or not width or not height:
        return True
    ratio = width / height
    if orientation == "widescreen":
        return ratio >= 1.3
    if orientation == "vertical":
        return ratio <= 0.8
    if orientation == "square":
        return 0.8 < ratio < 1.3
    return True


def make_uid(provider: str, media_type: str, asset_id: str) -> str:
    return f"{provider}:{media_type}:{asset_id}"


@dataclass
class SearchSpec:
    query: str
    per_page: int = 6
    images: bool = True
    videos: bool = True
    orientation: str = "any"
    min_width: int = 0
    safe: bool = True
    lang: str = "en"


class Provider:
    name = "provider"
    needs_key = False
    supports_images = False
    supports_videos = False

    def __init__(self, credentials: Optional[dict[str, Any]] = None):
        self.credentials = credentials or {}

    def is_configured(self) -> bool:
        return True

    def search(self, spec: SearchSpec) -> list[Candidate]:
        rows: list[Candidate] = []
        if spec.images and self.supports_images:
            rows.extend(self.search_images(spec))
        if spec.videos and self.supports_videos:
            rows.extend(self.search_videos(spec))
        return [row for row in rows if self._passes(row, spec)]

    def search_images(self, spec: SearchSpec) -> list[Candidate]:
        return []

    def search_videos(self, spec: SearchSpec) -> list[Candidate]:
        return []

    def _passes(self, row: Candidate, spec: SearchSpec) -> bool:
        if spec.min_width and row.width and row.width < spec.min_width:
            return False
        return orientation_ok(row.width, row.height, spec.orientation)
