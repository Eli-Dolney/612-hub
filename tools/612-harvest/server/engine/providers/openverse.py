from __future__ import annotations

from server.engine.models import Candidate
from server.engine.providers.base import Provider, SearchSpec, make_uid
from server.engine.io_util import HTTP


class OpenverseProvider(Provider):
    name = "openverse"
    supports_images = True
    supports_videos = False

    def search_images(self, spec: SearchSpec) -> list[Candidate]:
        params = {
            "q": spec.query,
            "page_size": min(spec.per_page, 20),
            "mature": "false" if spec.safe else "true",
        }
        response = HTTP.get("https://api.openverse.org/v1/images/", params=params, timeout=30)
        response.raise_for_status()
        rows: list[Candidate] = []
        for item in response.json().get("results") or []:
            asset_id = str(item.get("id") or "")
            if not asset_id:
                continue
            width = int(item.get("width") or 0)
            height = int(item.get("height") or 0)
            url = str(item.get("url") or "")
            rows.append(
                Candidate(
                    uid=make_uid(self.name, "images", asset_id),
                    provider=self.name,
                    media_type="images",
                    id=asset_id,
                    author=str(item.get("creator") or ""),
                    source_url=str(item.get("foreign_landing_url") or item.get("detail_url") or ""),
                    download_url=url,
                    preview_url=str(item.get("thumbnail") or url),
                    license=str(item.get("license") or "CC").upper(),
                    width=width,
                    height=height,
                    ext_hint=".jpg",
                )
            )
        return rows
