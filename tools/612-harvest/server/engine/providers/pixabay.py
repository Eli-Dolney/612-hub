from __future__ import annotations

from server.engine.models import Candidate
from server.engine.providers.base import Provider, SearchSpec, make_uid
from server.engine.io_util import HTTP


class PixabayProvider(Provider):
    name = "pixabay"
    needs_key = True
    supports_images = True
    supports_videos = True

    def is_configured(self) -> bool:
        return bool(self.credentials.get("api_key"))

    def _params(self, spec: SearchSpec) -> dict[str, str | int]:
        params: dict[str, str | int] = {
            "key": str(self.credentials.get("api_key")),
            "q": spec.query,
            "per_page": min(spec.per_page * 2, 40),
        }
        if spec.safe:
            params["safesearch"] = "true"
        if spec.lang:
            params["lang"] = spec.lang
        if spec.orientation == "widescreen":
            params["orientation"] = "horizontal"
        elif spec.orientation == "vertical":
            params["orientation"] = "vertical"
        return params

    def search_images(self, spec: SearchSpec) -> list[Candidate]:
        response = HTTP.get("https://pixabay.com/api/", params=self._params(spec), timeout=30)
        response.raise_for_status()
        rows: list[Candidate] = []
        for hit in response.json().get("hits") or []:
            asset_id = str(hit.get("id") or "")
            rows.append(
                Candidate(
                    uid=make_uid(self.name, "images", asset_id),
                    provider=self.name,
                    media_type="images",
                    id=asset_id,
                    author=str(hit.get("user") or ""),
                    source_url=str(hit.get("pageURL") or ""),
                    download_url=str(hit.get("largeImageURL") or hit.get("webformatURL") or ""),
                    preview_url=str(hit.get("webformatURL") or hit.get("previewURL") or ""),
                    license="Pixabay License",
                    width=int(hit.get("imageWidth") or 0),
                    height=int(hit.get("imageHeight") or 0),
                    ext_hint=".jpg",
                )
            )
            if len(rows) >= spec.per_page:
                break
        return rows

    def search_videos(self, spec: SearchSpec) -> list[Candidate]:
        response = HTTP.get("https://pixabay.com/api/videos/", params=self._params(spec), timeout=30)
        response.raise_for_status()
        rows: list[Candidate] = []
        for hit in response.json().get("hits") or []:
            videos = hit.get("videos") or {}
            large = videos.get("large") or videos.get("medium") or videos.get("small") or {}
            tiny = videos.get("tiny") or videos.get("small") or large
            asset_id = str(hit.get("id") or "")
            rows.append(
                Candidate(
                    uid=make_uid(self.name, "videos", asset_id),
                    provider=self.name,
                    media_type="videos",
                    id=asset_id,
                    author=str(hit.get("user") or ""),
                    source_url=str(hit.get("pageURL") or ""),
                    download_url=str(large.get("url") or ""),
                    preview_url=f"https://i.vimeocdn.com/video/{hit.get('picture_id')}_640x360.jpg"
                    if hit.get("picture_id")
                    else "",
                    play_url=str(tiny.get("url") or large.get("url") or ""),
                    license="Pixabay License",
                    width=int(large.get("width") or 0),
                    height=int(large.get("height") or 0),
                    duration=float(hit.get("duration") or 0),
                    ext_hint=".mp4",
                )
            )
            if len(rows) >= spec.per_page:
                break
        return rows
