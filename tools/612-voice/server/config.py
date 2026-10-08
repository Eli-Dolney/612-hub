from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / "voices"
SHOWS_DIR = ROOT / "shows"
VOICES_INDEX = VOICES_DIR / "voices.json"

APP_TITLE = "612 Voice"
APP_VERSION = "1.0.0"

TARGET_SR = 48000
LUFS_TARGET = -16.0
PROMPT_SR = 24000
MAX_PROMPT_SECONDS = 30.0

EMPHASIS = {
    "normal": (0.45, 0.55, 0.75),
    "emphasis": (0.65, 0.50, 0.70),
    "dramatic": (0.85, 0.45, 0.65),
    "calm": (0.30, 0.65, 0.85),
    "whisper": (0.25, 0.70, 0.80),
}

SPEAKERS = ("A", "B", "C", "D")
