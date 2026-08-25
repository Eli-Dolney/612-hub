"""GrokHub paths."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = Path.home() / "Desktop"
LOGS = ROOT / "logs"

APP_TITLE = "GrokHub"
APP_VERSION = "1.2.0"
UI_PORT = 5181
API_PORT = 8793
PREFS_PATH = LOGS / "prefs.json"
