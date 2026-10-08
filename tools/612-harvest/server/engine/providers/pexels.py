from __future__ import annotations

from server.engine.models import Candidate
from server.engine.providers.base import Provider, SearchSpec, make_uid
from server.engine.io_util import HTTP


class PexelsProvider(Provider):
    name = "pexels"
    needs_key = True
    supports_images = True
    supports_videos = True

    def is_configured(self) -> bool:
        return bool(self.credentials.get("api_key"))

    def _headers(self) -> dict[str, str]:
        return {"Authorization": str(self.credentials.get("api_key"))}

    def search_images(self, spec: SearchSpec) -> list[Candidate]:
        params = {"query": spec.query, "per_page": min(spec.per_page * 2, 40)}
        if spec.orientation == "widescreen":
            params["orientation"] = "landscape"
        elif spec.orientation == "vertical":
            params["orientation"] = "portrait"
        elif spec.orientation == "square":
            params["orientation"] = "square"
        response = HTTP.get("https://api.pexels.com/v1/search", headers=self._headers(), params=params, timeout=30)
        response.raise_for_status()
        rows: list[Candidate] = []
        for photo in response.json().get("photos") or []:
            src = photo.get("src") or {}
            asset_id = str(photo.get("id") or "")
            rows.append(
                Candidate(
                    uid=make_uid(self.name, "images", asset_id),
                    provider=self.name,
                    media_type="images",
                    id=asset_id,
                    author=str(photo.get("photographer") or ""),
                    source_url=str(photo.get("url") or ""),
                    download_url=str(src.get("original") or src.get("large2x") or src.get("large") or ""),
                    preview_url=str(src.get("medium") or src.get("small") or src.get("tiny") or ""),
                    license="Pexels License",
                    width=int(photo.get("width") or 0),
                    height=int(photo.get("height") or 0),
                    ext_hint=".jpg",
                )
            )
            if len(rows) >= spec.per_page:
                break
        return rows

    def search_videos(self, spec: SearchSpec) -> list[Candidate]:
        params = {"query": spec.query, "per_page": min(spec.per_page * 2, 40)}
        if spec.orientation == "widescreen":
            params["orientation"] = "landscape"
        elif spec.orientation == "vertical":
            params["orientation"] = "portrait"
        response = HTTP.get("https://api.pexels.com/videos/search", headers=self._headers(), params=params, timeout=30)
        response.raise_for_status()
        rows: list[Candidate] = []
        for video in response.json().get("videos") or []:
            files = sorted(
                video.get("video_files") or [],
                key=lambda f: (f.get("width") or 0) * (f.get("height") or 0),
                reverse=True,
            )
            best = files[0] if files else {}
            small = next((f for f in reversed(files) if str(f.get("file_type") or "").endswith("mp4")), {}) or (
                files[-1] if files else {}
            )
            asset_id = str(video.get("id") or "")
            width = int(best.get("width") or video.get("width") or 0)
            height = int(best.get("height") or video.get("height") or 0)
            rows.append(
                Candidate(
                    uid=make_uid(self.name, "videos", asset_id),
                    provider=self.name,
                    media_type="videos",
                    id=asset_id,
                    author=str((video.get("user") or {}).get("name") or ""),
                    source_url=str(video.get("url") or ""),
                    download_url=str(best.get("link") or ""),
                    preview_url=str(video.get("image") or ""),
                    play_url=str(small.get("link") or best.get("link") or ""),
                    license="Pexels License",
                    width=width,
                    height=height,
                    duration=float(video.get("duration") or 0),
                    ext_hint=".mp4",
                )
            )
            if len(rows) >= spec.per_page:
                break
        return rows
