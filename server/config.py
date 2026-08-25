"""Paths and defaults for GrokClip."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT / "projects"
WHISPER_CACHE = Path.home() / ".cache" / "grokclip" / "whisper"

APP_TITLE = "GrokClip"
APP_VERSION = "1.5.0"

UI_PORT = 5180
API_PORT = 8792
GROKEDIT_URL = "http://127.0.0.1:5174"
GROKPULL_DOWNLOADS = Path.home() / "Desktop" / "grok-pull" / "downloads"

SUPPORTED = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mpg", ".mpeg"}
WHISPER_MODELS = ("tiny", "base", "small", "medium")
DEFAULT_MODEL = "base"

DEFAULT_SETTINGS = {
    "model": DEFAULT_MODEL,
    "remove_fillers": True,
    "tighten_pauses": True,
    "split_pause_s": 0.8,
    "padding_s": 0.08,
    "merge_gap_s": 0.25,
    "layout": "blur",  # crop | blur
    "frame": "9:16",  # 9:16 | 16:9 | 1:1 | 4:5
    "captions": True,
    "caption_style": "hook",  # hook | boxed | minimal
    "caption_position": "blur",  # blur | lower | center
    "caption_active": "#f5a524",
    "caption_rest": "#ffffff",
    "caption_size": "m",  # s | m | l
    "caption_words": 4,
    "caption_karaoke": True,
    "caption_uppercase": False,
    "vad_filter": "auto",
    "credit": "",
    "credit_corner": "bl",  # bl | br
    "border": "glow",  # none | solid | glow
    "border_color": "#c084fc",
    "logo": "",
}
