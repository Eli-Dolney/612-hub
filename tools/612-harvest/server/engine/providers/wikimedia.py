from __future__ import annotations

from server.engine.models import Candidate
from server.engine.providers.base import Provider, SearchSpec, make_uid
from server.engine.io_util import HTTP


class WikimediaProvider(Provider):
    name = "wikimedia"
    supports_images = True
    supports_videos = True

    def _search(self, spec: SearchSpec, filetype: str, media_type: str, limit: int) -> list[Candidate]:
        params = {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"filetype:{filetype} {spec.query}",
            "gsrnamespace": 6,
            "gsrlimit": min(max(limit, 1), 20),
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": 640,
            "format": "json",
            "origin": "*",
        }
        response = HTTP.get("https://commons.wikimedia.org/w/api.php", params=params, timeout=30)
        response.raise_for_status()
        pages = (response.json().get("query") or {}).get("pages") or {}
        rows: list[Candidate] = []
        for page in pages.values():
            info = (page.get("imageinfo") or [{}])[0]
            mime = str(info.get("mime") or "")
            url = str(info.get("url") or "")
            if not url:
                continue
            if media_type == "images" and not mime.startswith("image/"):
                continue
            if media_type == "videos" and not mime.startswith("video/"):
                continue
            meta = info.get("extmetadata") or {}
            artist = ""
            license_name = "Wikimedia Commons"
            if isinstance(meta, dict):
                artist = str((meta.get("Artist") or {}).get("value") or "")
                artist = _strip_html(artist)
                license_name = str((meta.get("LicenseShortName") or {}).get("value") or license_name)
            asset_id = str(page.get("pageid") or page.get("title") or url)
            width = int(info.get("width") or 0)
            height = int(info.get("height") or 0)
            ext = ".jpg"
            if "png" in mime:
                ext = ".png"
            elif "gif" in mime:
                ext = ".gif"
            elif "webp" in mime:
                ext = ".webp"
            elif "webm" in mime:
                ext = ".webm"
            elif "mp4" in mime:
                ext = ".mp4"
            elif "ogg" in mime or "ogv" in mime:
                ext = ".ogv"
            rows.append(
                Candidate(
                    uid=make_uid(self.name, media_type, asset_id),
                    provider=self.name,
                    media_type=media_type,
                    id=asset_id,
                    author=artist,
                    source_url=f"https://commons.wikimedia.org/wiki/{page.get('title', '')}",
                    download_url=url,
                    preview_url=str(info.get("thumburl") or url),
                    play_url=url if media_type == "videos" else "",
                    license=license_name,
                    width=width,
                    height=height,
                    ext_hint=ext,
                )
            )
        return rows

    def search_images(self, spec: SearchSpec) -> list[Candidate]:
        return self._search(spec, "bitmap", "images", spec.per_page)

    def search_videos(self, spec: SearchSpec) -> list[Candidate]:
        return self._search(spec, "video", "videos", spec.per_page)


def _strip_html(value: str) -> str:
    import re

    text = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", text).strip()
