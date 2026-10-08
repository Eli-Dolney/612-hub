"""Paths and defaults for 612 Clip."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT / "projects"
INBOX_DIR = ROOT / "inbox"
WHISPER_CACHE = Path.home() / ".cache" / "grokclip" / "whisper"

APP_TITLE = "612 Clip"
APP_VERSION = "1.7.0"
FONTS_DIR = ROOT / "public" / "fonts"

UI_PORT = 5180
API_PORT = 8792
GROKEDIT_URL = "http://127.0.0.1:5174"
GROKPULL_DOWNLOADS = ROOT.parent / "612-pull" / "downloads"

SUPPORTED = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mpg", ".mpeg"}
WHISPER_MODELS = ("tiny", "base", "small", "medium")
DEFAULT_MODEL = "base"

# Inbox watcher: suggest | shorts | silent
INBOX_RECIPES = ("suggest", "shorts", "silent")
DEFAULT_INBOX = {
    "enabled": False,
    "recipe": "shorts",
    "path": "",  # empty → INBOX_DIR
}

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
    "caption_profile": "intro",  # intro | tts | silent | custom
    "caption_style": "hook",  # hook | boxed | minimal
    "caption_position": "blur",  # blur | lower | center
    "caption_font": "inter",
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
    "suggest_target_s": 30,
}

CAPTION_FONTS = (
    {"id": "inter", "family": "Inter", "file": "Inter-Bold.ttf"},
    {"id": "montserrat", "family": "Montserrat", "file": "Montserrat-Bold.ttf"},
    {"id": "oswald", "family": "Oswald", "file": "Oswald-Bold.ttf"},
    {"id": "anton", "family": "Anton", "file": "Anton-Regular.ttf"},
    {"id": "rubik", "family": "Rubik", "file": "Rubik-Bold.ttf"},
)

CAPTION_PROFILES = {
    "intro": {
        "caption_profile": "intro",
        "captions": True,
        "caption_style": "hook",
        "caption_position": "blur",
        "caption_font": "anton",
        "caption_size": "l",
        "caption_words": 3,
        "caption_karaoke": True,
        "caption_uppercase": True,
        "caption_active": "#f5a524",
        "caption_rest": "#ffffff",
    },
    "tts": {
        "caption_profile": "tts",
        "captions": True,
        "caption_style": "boxed",
        "caption_position": "lower",
        "caption_font": "montserrat",
        "caption_size": "m",
        "caption_words": 6,
        "caption_karaoke": False,
        "caption_uppercase": False,
        "caption_active": "#ffffff",
        "caption_rest": "#ffffff",
    },
    "silent": {
        "caption_profile": "silent",
        "captions": False,
    },
}

PLATFORM_PRESETS = {
    "tiktok": {"frame": "9:16", "caption_position": "blur", "layout": "blur"},
    "reels": {"frame": "4:5", "caption_position": "lower", "layout": "blur"},
    "shorts": {"frame": "9:16", "caption_position": "blur", "layout": "blur"},
}
