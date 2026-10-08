"""Local config for 612 Harvest."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
PROJECTS_DIR = ROOT / "projects"
APP_TITLE = "612 Harvest"
APP_VERSION = "1.0.0"
USER_AGENT = "612 Harvest/1.0 (local documentary stock reel; +http://127.0.0.1:5179)"

DEFAULTS: dict[str, Any] = {
    "output_dir": "projects",
    "defaults": {
        "timeout_sec": 30,
        "retries": 2,
        "per_provider": 6,
        "user_agent": USER_AGENT,
    },
    "providers": {
        "pexels": {"api_key": None},
        "pixabay": {"api_key": None},
        "unsplash": {"access_key": None},
    },
}


def _deep_update(base: dict[str, Any], overrides: dict[str, Any]) -> None:
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], value)
        else:
            base[key] = value


def load_config() -> dict[str, Any]:
    cfg: dict[str, Any] = json.loads(json.dumps(DEFAULTS))
    if CONFIG_PATH.is_file():
        _deep_update(cfg, json.loads(CONFIG_PATH.read_text(encoding="utf-8")))

    providers = cfg.setdefault("providers", {})
    providers.setdefault("pexels", {})["api_key"] = os.getenv("PEXELS_API_KEY") or providers.get("pexels", {}).get(
        "api_key"
    )
    providers.setdefault("pixabay", {})["api_key"] = os.getenv("PIXABAY_API_KEY") or providers.get("pixabay", {}).get(
        "api_key"
    )
    providers.setdefault("unsplash", {})["access_key"] = os.getenv("UNSPLASH_ACCESS_KEY") or providers.get(
        "unsplash", {}
    ).get("access_key")
    return cfg


def save_config(update: dict[str, Any]) -> dict[str, Any]:
    cfg = load_config()
    _deep_update(cfg, update)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return load_config()


def mask_secret(value: str | None) -> str:
    if not value:
        return ""
    text = str(value)
    if len(text) <= 6:
        return "••••"
    return text[:4] + "…" + text[-2:]
