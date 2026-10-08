"""Fit a clip onto a canvas: crop, or blur-fill like Shorts / YouTube compilations."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from server.engine import ffmpeg as ff
from server.engine.reframe import crop_window

FRAMES = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
}

BORDER_PX = {"none": 0, "solid": 6, "glow": 8}
GLOW_EXTRA = 18


def canvas_size(frame: str) -> tuple[int, int]:
    return FRAMES.get(frame, FRAMES["9:16"])


def _color(hex_color: str) -> str:
    raw = (hex_color or "#c084fc").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(c * 2 for c in raw)
    if len(raw) != 6:
        raw = "c084fc"
    return f"0x{raw.upper()}"


def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "%%")
    )


def _font() -> str:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        if Path(path).exists():
            return path
    return ""


def fit_filter(
    *,
    canvas_w: int,
    canvas_h: int,
    layout: str,
    src_w: int,
    src_h: int,
    cx: float,
    cy: float,
    border: str,
    border_color: str,
) -> str:
    """Return a -filter_complex graph ending in [vout]. Input is [0:v]."""
    pad = BORDER_PX.get(border, 0)
    color = _color(border_color)
    if layout == "crop":
        x, y, cw, ch = crop_window(src_w, src_h, cx, cy, (canvas_w, canvas_h))
        core = f"[0:v]crop={cw}:{ch}:{x}:{y},scale={canvas_w}:{canvas_h}:flags=lanczos"
        if pad:
            return (
                f"{core},"
                f"pad=iw+{pad * 2}:ih+{pad * 2}:{pad}:{pad}:color={color},"
                f"scale={canvas_w}:{canvas_h}:flags=lanczos,setsar=1,format=yuv420p[vout]"
            )
        return f"{core},setsar=1,format=yuv420p[vout]"

    # Blur-fill: cover the canvas with a blurred copy, contain the sharp plate, border the plate.
    glow = GLOW_EXTRA if border == "glow" else 0
    room = pad + glow
    inner_w = canvas_w - room * 2
    inner_h = canvas_h - room * 2
    inner_w = max(2, inner_w - inner_w % 2)
    inner_h = max(2, inner_h - inner_h % 2)
    graph = (
        f"[0:v]split=2[bg][fg];"
        f"[bg]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
        f"crop={canvas_w}:{canvas_h},boxblur=24:2,setsar=1[b];"
        f"[fg]scale={inner_w}:{inner_h}:force_original_aspect_ratio=decrease:"
        f"force_divisible_by=2:flags=lanczos[f0];"
    )
    if glow:
        graph += (
            f"[f0]split=2[fsharp][fglowsrc];"
            f"[fglowsrc]pad=iw+{2 * (pad + glow)}:ih+{2 * (pad + glow)}:"
            f"{pad + glow}:{pad + glow}:color={color},boxblur=14:1[fglow];"
            f"[fsharp]pad=iw+{2 * pad}:ih+{2 * pad}:{pad}:{pad}:color={color}[f];"
            f"[b][fglow]overlay=(W-w)/2:(H-h)/2[b1];"
            f"[b1][f]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[vout]"
        )
    elif pad:
        graph += (
            f"[f0]pad=iw+{2 * pad}:ih+{2 * pad}:{pad}:{pad}:color={color}[f];"
            f"[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[vout]"
        )
    else:
        graph += "[b][f0]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[vout]"
    return graph


def encode_fit(
    src: Path,
    dest: Path,
    start: float,
    end: float,
    *,
    canvas: tuple[int, int],
    layout: str,
    src_w: int,
    src_h: int,
    cx: float,
    cy: float,
    border: str,
    border_color: str,
    has_audio: bool,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    duration = max(0.05, end - start)
    graph = fit_filter(
        canvas_w=canvas[0],
        canvas_h=canvas[1],
        layout=layout,
        src_w=src_w,
        src_h=src_h,
        cx=cx,
        cy=cy,
        border=border,
        border_color=border_color,
    )
    cmd = [
        ff.which_ffmpeg(),
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(src),
        "-t",
        f"{duration:.3f}",
        "-filter_complex",
        graph,
        "-map",
        "[vout]",
    ]
    if has_audio:
        cmd += ["-map", "0:a:0?", "-shortest"]
    cmd += ff.video_args(portrait=canvas[1] > canvas[0])
    cmd += ff.audio_args(has_audio)
    cmd += ["-movflags", "+faststart", str(dest)]
    ff.run(cmd, timeout=600)


def brand(
    src: Path,
    dest: Path,
    *,
    credit: str,
    credit_corner: str,
    logo: Optional[Path],
    has_audio: bool,
    canvas: tuple[int, int],
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    filters: list[str] = []
    current = "0:v"
    inputs = [ff.which_ffmpeg(), "-y", "-i", str(src)]
    idx = 1
    if logo and logo.is_file():
        inputs += ["-i", str(logo)]
        max_w = max(120, canvas[0] // 8)
        filters.append(f"[{idx}:v]format=rgba,scale={max_w}:-1[lg]")
        # Logo sits in the opposite lower corner from the credit.
        if credit_corner == "br":
            ox, oy = "40", "H-h-40"
        else:
            ox, oy = "W-w-40", "H-h-40"
        filters.append(f"[{current}][lg]overlay={ox}:{oy}[vlogo]")
        current = "vlogo"
        idx += 1

    text = (credit or "").strip()
    if text:
        font = _font()
        font_arg = f"fontfile={font}:" if font else ""
        if credit_corner == "br":
            x, y = "w-tw-48", "h-th-48"
        else:
            x, y = "48", "h-th-48"
        filters.append(
            f"[{current}]drawtext={font_arg}text='{_escape_drawtext(text)}':"
            f"x={x}:y={y}:fontsize={max(28, canvas[0] // 42)}:fontcolor=white:"
            f"borderw=3:bordercolor=black@0.85[vtxt]"
        )
        current = "vtxt"

    cmd = inputs
    if filters:
        cmd += ["-filter_complex", ";".join(filters), "-map", f"[{current}]"]
        if has_audio:
            cmd += ["-map", "0:a:0?", "-shortest"]
        cmd += ff.video_args(portrait=canvas[1] > canvas[0])
        cmd += ff.audio_args(has_audio)
    else:
        cmd += ["-c", "copy"]
    cmd += ["-movflags", "+faststart", str(dest)]
    ff.run(cmd, timeout=900)
