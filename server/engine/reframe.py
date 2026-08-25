"""9:16 face crop. Haar on FFmpeg stills — no MediaPipe, no OpenCV VideoCapture."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np

from server.engine.ffmpeg import grab_frame

ProgressFn = Callable[[float, str], None]


def _cascade():
    import cv2

    path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    det = cv2.CascadeClassifier(str(path))
    if det.empty():
        raise RuntimeError("OpenCV face cascade failed to load")
    return det


def sample_faces(
    src: Path,
    duration: float,
    *,
    progress: Optional[ProgressFn] = None,
) -> list[dict[str, Any]]:
    try:
        import cv2
        det = _cascade()
    except Exception:
        return []
    if duration <= 0:
        return []
    max_samples = 240
    fps = 2.0 if duration <= 180 else max(0.4, max_samples / duration)
    step = 1.0 / fps
    tmp = Path(tempfile.mkdtemp(prefix="grokclip-faces-"))
    samples: list[dict[str, Any]] = []
    last = (0.5, 0.38)
    t = 0.0
    index = 0
    try:
        while t < duration + 0.01 and len(samples) < max_samples:
            frame_path = tmp / f"{index:04d}.jpg"
            cx, cy, detected = last[0], last[1], False
            try:
                grab_frame(src, frame_path, t)
                image = cv2.imread(str(frame_path), cv2.IMREAD_GRAYSCALE)
                if image is not None:
                    height, width = image.shape[:2]
                    faces = det.detectMultiScale(
                        image, scaleFactor=1.15, minNeighbors=5, minSize=(48, 48)
                    )
                    if len(faces):
                        faces = sorted(
                            faces,
                            key=lambda f: abs((f[0] + f[2] / 2) / max(width, 1) - last[0]),
                        )
                        x, y, w, h = faces[0]
                        cx = (x + w / 2) / width
                        cy = (y + h * 0.38) / height
                        detected = True
                        last = (cx, cy)
            except Exception:
                pass
            samples.append(
                {
                    "t": round(t, 3),
                    "cx": round(float(cx), 4),
                    "cy": round(float(cy), 4),
                    "detected": detected,
                }
            )
            index += 1
            t += step
            if progress and duration:
                progress(min(0.95, t / duration), "Tracking faces")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return samples


def center_for_range(samples: list[dict[str, Any]], start: float, end: float) -> tuple[float, float]:
    hits = [s for s in samples if start - 0.25 <= s["t"] <= end + 0.25 and s.get("detected")]
    if not hits:
        hits = [s for s in samples if start - 0.25 <= s["t"] <= end + 0.25]
    if not hits:
        return 0.5, 0.38
    xs = [s["cx"] for s in hits]
    ys = [s["cy"] for s in hits]
    return float(np.median(xs)), float(np.median(ys))


def crop_window(
    width: int,
    height: int,
    cx: float,
    cy: float,
    aspect: tuple[int, int] = (9, 16),
) -> tuple[int, int, int, int]:
    aw, ah = aspect
    crop_h = height
    crop_w = int(round(crop_h * aw / ah))
    if crop_w > width:
        crop_w = width
        crop_h = int(round(crop_w * ah / aw))
    crop_w -= crop_w % 2
    crop_h -= crop_h % 2
    x = int(round(cx * width - crop_w / 2))
    y = int(round(cy * height - crop_h / 2))
    x = max(0, min(x, width - crop_w))
    y = max(0, min(y, height - crop_h))
    return x, y, crop_w, crop_h
