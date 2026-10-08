from __future__ import annotations

from server.engine.models import Candidate
from server.engine.providers.base import Provider, SearchSpec, make_uid
from server.engine.io_util import HTTP


class UnsplashProvider(Provider):
    name = "unsplash"
    needs_key = True
    supports_images = True
    supports_videos = False

    def is_configured(self) -> bool:
        return bool(self.credentials.get("access_key"))

    def search_images(self, spec: SearchSpec) -> list[Candidate]:
        params: dict[str, str | int] = {"query": spec.query, "per_page": min(spec.per_page * 2, 30)}
        if spec.orientation == "widescreen":
            params["orientation"] = "landscape"
        elif spec.orientation == "vertical":
            params["orientation"] = "portrait"
        elif spec.orientation == "square":
            params["orientation"] = "squarish"
        response = HTTP.get(
            "https://api.unsplash.com/search/photos",
            headers={"Authorization": f"Client-ID {self.credentials.get('access_key')}"},
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        rows: list[Candidate] = []
        for photo in response.json().get("results") or []:
            urls = photo.get("urls") or {}
            user = photo.get("user") or {}
            links = photo.get("links") or {}
            asset_id = str(photo.get("id") or "")
            rows.append(
                Candidate(
                    uid=make_uid(self.name, "images", asset_id),
                    provider=self.name,
                    media_type="images",
                    id=asset_id,
                    author=str(user.get("name") or ""),
                    source_url=str(links.get("html") or ""),
                    download_url=str(urls.get("full") or urls.get("raw") or urls.get("regular") or ""),
                    preview_url=str(urls.get("small") or urls.get("regular") or ""),
                    license="Unsplash License",
                    width=int(photo.get("width") or 0),
                    height=int(photo.get("height") or 0),
                    ext_hint=".jpg",
                )
            )
            if len(rows) >= spec.per_page:
                break
        return rows
