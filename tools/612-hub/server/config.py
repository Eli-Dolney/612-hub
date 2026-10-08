"""612 Hub paths."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = ROOT.parent  # sibling tools in a checkout at any location
LOGS = ROOT / "logs"

APP_TITLE = "612 Hub"
APP_VERSION = "1.2.0"
UI_PORT = 5181
API_PORT = 8793
PREFS_PATH = LOGS / "prefs.json"
