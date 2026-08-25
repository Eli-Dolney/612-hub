"""SRT / karaoke ASS captions, plus ffmpeg burn-in styles."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from server.engine.compose import canvas_size


def _ts(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def hex_to_ass(hex_color: str, *, alpha: str = "00") -> str:
    """#RRGGBB → ASS &HAABBGGRR."""
    raw = (hex_color or "#ffffff").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(c * 2 for c in raw)
    if len(raw) != 6:
        raw = "ffffff"
    rr, gg, bb = raw[0:2], raw[2:4], raw[4:6]
    return f"&H{alpha}{bb.upper()}{gg.upper()}{rr.upper()}"


def group_cues(words: list[dict[str, Any]], *, max_words: int = 4, max_s: float = 2.0) -> list[dict[str, Any]]:
    return [_cue(bucket) for bucket in _buckets(words, max_words=max_words, max_s=max_s)]


def group_karaoke(words: list[dict[str, Any]], *, max_words: int = 4, max_s: float = 2.0) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    for bucket in _buckets(words, max_words=max_words, max_s=max_s):
        cue = _cue(bucket)
        cue["words"] = [
            {"word": str(w.get("word") or "").strip(), "start": float(w["start"]), "end": float(w["end"])}
            for w in bucket
            if str(w.get("word") or "").strip()
        ]
        cues.append(cue)
    return cues


def _buckets(words: list[dict[str, Any]], *, max_words: int, max_s: float) -> list[list[dict[str, Any]]]:
    runs: list[list[dict[str, Any]]] = []
    bucket: list[dict[str, Any]] = []
    for word in words:
        token = str(word.get("word") or "").strip()
        if not token:
            continue
        item = {**word, "word": token}
        if not bucket:
            bucket = [item]
            continue
        long = float(item["end"]) - float(bucket[0]["start"]) > max_s
        many = len(bucket) >= max_words
        punct = str(bucket[-1]["word"]).endswith((".", "?", "!", ","))
        gap = float(item["start"]) - float(bucket[-1]["end"]) > 0.45
        if long or many or punct or gap:
            runs.append(bucket)
            bucket = [item]
        else:
            bucket.append(item)
    if bucket:
        runs.append(bucket)
    return runs


def _cue(bucket: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "start": float(bucket[0]["start"]),
        "end": max(float(bucket[-1]["end"]), float(bucket[0]["start"]) + 0.4),
        "text": " ".join(str(w["word"]) for w in bucket),
    }


def write_srt(cues: list[dict[str, Any]], dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for i, cue in enumerate(cues, start=1):
        lines.append(str(i))
        lines.append(f"{_ts(cue['start'])} --> {_ts(cue['end'])}")
        lines.append(cue["text"])
        lines.append("")
    dest.write_text("\n".join(lines), encoding="utf-8")
    return dest


def letterbox_margin_v(
    *,
    frame: str = "9:16",
    layout: str = "blur",
    src_w: int = 1920,
    src_h: int = 1080,
    position: str = "blur",
) -> int:
    """Pixels from the bottom for caption placement."""
    cw, ch = canvas_size(frame)
    if position == "center":
        return int(ch * 0.42)
    if position == "lower":
        return 160 if ch >= 1600 else 96
    # blur — sit in the lower letterbox when possible
    if layout != "blur" or not src_w or not src_h:
        return 140 if ch >= cw else 72
    scale = min(cw / src_w, ch / src_h)
    plate_h = src_h * scale
    lower = (ch - plate_h) / 2
    if lower < 90:
        return 140 if ch >= cw else 72
    return int(max(96, min(lower * 0.45, lower - 36)))


def _font_size(ch: int, size: str) -> int:
    base = 72 if ch >= 1600 else 48 if ch >= 1000 else 32
    if size == "s":
        return max(24, base - 18)
    if size == "l":
        return base + 18
    return base


def _karaoke_text(words: list[dict[str, Any]], *, uppercase: bool = False) -> str:
    parts: list[str] = []
    for i, word in enumerate(words):
        nxt = words[i + 1]["start"] if i + 1 < len(words) else word["end"]
        dur = max(0.04, float(nxt) - float(word["start"]))
        cs = max(1, int(round(dur * 100)))
        token = str(word["word"])
        if uppercase:
            token = token.upper()
        parts.append(f"{{\\k{cs}}}{_ass_escape(token)}")
    return " ".join(parts)


def write_ass(
    cues: list[dict[str, Any]],
    dest: Path,
    *,
    frame: str = "9:16",
    layout: str = "blur",
    src_w: int = 1920,
    src_h: int = 1080,
    style: str = "hook",
    settings: Optional[dict[str, Any]] = None,
) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cfg = settings or {}
    style = str(cfg.get("caption_style") or style or "hook")
    position = str(cfg.get("caption_position") or ("blur" if style == "hook" else "lower"))
    size_key = str(cfg.get("caption_size") or "m")
    karaoke = bool(cfg.get("caption_karaoke", style == "hook"))
    uppercase = bool(cfg.get("caption_uppercase", False))
    active = str(cfg.get("caption_active") or ("#f5a524" if style == "hook" else "#ffffff"))
    rest = str(cfg.get("caption_rest") or "#ffffff")
    boxed = style == "boxed"

    cw, ch = canvas_size(frame)
    margin_v = letterbox_margin_v(
        frame=frame,
        layout=layout,
        src_w=src_w,
        src_h=src_h,
        position=position,
    )
    size = _font_size(ch, size_key)
    if style == "minimal" and size_key == "m":
        size = max(28, size - 12)

    primary = hex_to_ass(active)  # karaoke highlight / main fill
    secondary = hex_to_ass(rest)  # karaoke unread
    outline = 4 if boxed else (3 if style == "minimal" else 8)
    border_style = 3 if boxed else 1
    font = "Arial" if style == "minimal" else "Arial Black"
    bold = 0 if style == "minimal" else -1
    alignment = 5 if position == "center" else 2

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {cw}
PlayResY: {ch}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,{font},{size},{primary},{secondary},&H00000000,&H80000000,{bold},0,0,0,100,100,0,0,{border_style},{outline},0,{alignment},48,48,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header.rstrip(), ""]
    for cue in cues:
        words = list(cue.get("words") or [])
        if karaoke and len(words) > 1:
            text = _karaoke_text(words, uppercase=uppercase)
        else:
            text = str(cue.get("text") or "")
            if uppercase:
                text = text.upper()
            text = _ass_escape(text)
        if not text:
            continue
        lines.append(
            f"Dialogue: 0,{_ass_time(float(cue['start']))},{_ass_time(float(cue['end']))},Hook,,0,0,0,,{text}"
        )
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return dest


def force_style(kind: str = "hook") -> str:
    if kind == "minimal":
        return "Fontname=Arial,Fontsize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=48"
    return "Fontname=Arial Black,Fontsize=18,PrimaryColour=&H0000F5FF,OutlineColour=&H00000000,Bold=1,Outline=3,Shadow=0,Alignment=2,MarginV=90"


def escape_subtitles(path: Path) -> str:
    text = str(path.resolve())
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", r"\'")
