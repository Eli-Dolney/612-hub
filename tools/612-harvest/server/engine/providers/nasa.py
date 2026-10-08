from __future__ import annotations

from server.engine.models import Candidate
from server.engine.providers.base import Provider, SearchSpec, make_uid
from server.engine.io_util import HTTP


class NasaProvider(Provider):
    name = "nasa"
    supports_images = True
    supports_videos = True

    def search(self, spec: SearchSpec) -> list[Candidate]:
        kinds = []
        if spec.images:
            kinds.append("image")
        if spec.videos:
            kinds.append("video")
        if not kinds:
            return []
        params = {"q": spec.query, "media_type": ",".join(kinds), "page_size": min(spec.per_page * 2, 40)}
        response = HTTP.get("https://images-api.nasa.gov/search", params=params, timeout=30)
        response.raise_for_status()
        items = ((response.json().get("collection") or {}).get("items") or [])[: spec.per_page * 2]
        rows: list[Candidate] = []
        for item in items:
            data = (item.get("data") or [{}])[0]
            nasa_id = str(data.get("nasa_id") or "")
            media_type = "videos" if data.get("media_type") == "video" else "images"
            if not nasa_id:
                continue
            links = item.get("links") or []
            preview = ""
            for link in links:
                if link.get("rel") == "preview" or str(link.get("render") or "") == "image":
                    preview = str(link.get("href") or "")
                    break
            if not preview and links:
                preview = str(links[0].get("href") or "")
            href = str(item.get("href") or "")
            download = preview
            play = ""
            if media_type == "videos":
                play = preview
                # orig mp4 is often adjacent to the collection JSON
                if href.endswith("collection.json"):
                    download = href.replace("~orig/collection.json", "~orig.mp4")
                    if download == href:
                        download = f"https://images-assets.nasa.gov/video/{nasa_id}/{nasa_id}~orig.mp4"
            rows.append(
                Candidate(
                    uid=make_uid(self.name, media_type, nasa_id),
                    provider=self.name,
                    media_type=media_type,
                    id=nasa_id,
                    author="NASA",
                    source_url=f"https://images.nasa.gov/details/{nasa_id}",
                    download_url=download or preview,
                    preview_url=preview,
                    play_url=play,
                    license="NASA Media",
                    width=0,
                    height=0,
                    ext_hint=".mp4" if media_type == "videos" else ".jpg",
                )
            )
            if len(rows) >= spec.per_page:
                break
        return rows
