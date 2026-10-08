from __future__ import annotations

from typing import Any

from server.config import load_config
from server.engine.providers.base import Provider
from server.engine.providers.nasa import NasaProvider
from server.engine.providers.openverse import OpenverseProvider
from server.engine.providers.pexels import PexelsProvider
from server.engine.providers.pixabay import PixabayProvider
from server.engine.providers.unsplash import UnsplashProvider
from server.engine.providers.wikimedia import WikimediaProvider

FACTORY = {
    "wikimedia": lambda creds: WikimediaProvider(creds),
    "openverse": lambda creds: OpenverseProvider(creds),
    "nasa": lambda creds: NasaProvider(creds),
    "pexels": lambda creds: PexelsProvider(creds),
    "pixabay": lambda creds: PixabayProvider(creds),
    "unsplash": lambda creds: UnsplashProvider(creds),
}

ZERO_KEY = {"wikimedia", "openverse", "nasa"}


def build_providers(names: list[str] | None = None) -> list[Provider]:
    cfg = load_config()
    creds = cfg.get("providers") or {}
    wanted = names or list(FACTORY)
    out: list[Provider] = []
    for name in wanted:
        if name not in FACTORY:
            continue
        client = FACTORY[name](creds.get(name) or {})
        if client.is_configured():
            out.append(client)
    return out


def provider_status() -> list[dict[str, Any]]:
    cfg = load_config()
    creds = cfg.get("providers") or {}
    rows = []
    for name, factory in FACTORY.items():
        client = factory(creds.get(name) or {})
        rows.append(
            {
                "name": name,
                "configured": client.is_configured(),
                "needs_key": client.needs_key,
                "images": client.supports_images,
                "videos": client.supports_videos,
                "zero_key": name in ZERO_KEY,
            }
        )
    return rows
