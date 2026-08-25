"""Run a queued recipe: pull → trim window → transcribe → export."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

from server.engine.pull import pull_url, validate_url
from server.engine.window import resolve_window
from server import pipeline

ProgressFn = Callable[[float, str], None]
StopFn = Callable[[], bool]
UpdateFn = Callable[..., None]


def _check(stop: Optional[StopFn]) -> None:
    if stop and stop():
        raise RuntimeError("Cancelled")


def _ops(recipe: dict[str, Any]) -> list[dict[str, Any]]:
    steps = list(recipe.get("steps") or [])
    source = recipe.get("source") or {}
    if source.get("kind") == "url" and not any(s.get("op") == "pull" for s in steps):
        steps = [{"op": "pull"}, *steps]
    if not any(s.get("op") == "export" for s in steps):
        has_speech = any(s.get("op") == "transcribe" for s in steps)
        steps.append({"op": "export", "captions": has_speech})
    return steps


def _ensure_probed(slug: str, progress: ProgressFn) -> None:
    data = pipeline.load_project(slug)
    duration = float((data.get("probe") or {}).get("duration") or 0)
    if duration > 0:
        return
    pipeline.probe_project(slug, progress)


def run_order(
    job: dict[str, Any],
    progress: ProgressFn,
    stop: Optional[StopFn],
    update: UpdateFn,
) -> dict[str, Any]:
    recipe = job.get("recipe") or {}
    steps = _ops(recipe)
    source = recipe.get("source") or {}
    overrides = dict(recipe.get("settings") or {})
    n = max(len(steps), 1)
    slug = str(source.get("slug") or job.get("project") or "")
    window: Optional[dict[str, Any]] = None
    captions: Optional[bool] = None

    def slice_progress(index: int, value: float, step: str) -> None:
        _check(stop)
        lo = index / n
        hi = (index + 1) / n
        progress(lo + (hi - lo) * min(1.0, max(0.0, value)), step)
        update(step_index=index, steps_total=n, step=step)

    for i, step in enumerate(steps):
        _check(stop)
        op = str(step.get("op") or "")
        update(step_index=i, steps_total=n)

        if op == "pull":
            url = validate_url(str(source.get("url") or step.get("url") or ""))
            slice_progress(i, 0.02, "Downloading")
            tmp = Path(tempfile.mkdtemp(prefix="grokclip-pull-"))
            try:
                path = pull_url(
                    url,
                    tmp,
                    progress=lambda v, s, idx=i: slice_progress(idx, v, s),
                    stop=stop,
                )
                row = pipeline.create_from_file(path, path.stem, require_home=False)
                slug = row["slug"]
                update(project=slug)
                slice_progress(i, 0.85, "Probe")
                pipeline.probe_project(slug, lambda v, s, idx=i: slice_progress(idx, 0.85 + 0.15 * v, s))
            finally:
                import shutil

                shutil.rmtree(tmp, ignore_errors=True)
            continue

        if not slug:
            raise RuntimeError("Queue this clip, or paste a URL to download")

        if op == "trim":
            slice_progress(i, 0.1, "Trim window")
            _ensure_probed(slug, lambda v, s, idx=i: slice_progress(idx, v, s))
            data = pipeline.load_project(slug)
            duration = float((data.get("probe") or {}).get("duration") or 0)
            window = resolve_window(
                duration,
                mode=str(step.get("mode") or "keep"),
                start=float(step.get("start") or 0),
                seconds=float(step.get("duration") or 30),
            )
            pipeline.set_window(slug, window)
            span = window["end"] - window["start"]
            slice_progress(i, 1.0, f"Window {span:.1f}s")
            continue

        if op == "transcribe":
            _ensure_probed(slug, lambda v, s, idx=i: slice_progress(idx, 0.05 * v, s))
            pipeline.transcribe_project(
                slug,
                lambda v, s, idx=i: slice_progress(idx, v, s),
                stop=stop,
                window=window,
                apply_stored_window=False,
            )
            continue

        if op == "export":
            if "captions" in step:
                captions = bool(step.get("captions"))
            elif captions is None:
                captions = any(s.get("op") == "transcribe" for s in steps)
            patch = dict(overrides)
            if captions is not None:
                patch["captions"] = captions
            slice_progress(i, 0.04, "Export")
            _ensure_probed(slug, lambda v, s, idx=i: slice_progress(idx, 0.04 * v, s))
            pipeline.export_project(
                slug,
                lambda v, s, idx=i: slice_progress(idx, v, s),
                settings_override=patch or None,
                window=window,
                apply_stored_window=False,
            )
            continue

        raise RuntimeError(f"Unknown step {op}")

    if not slug:
        raise RuntimeError("Order produced no project")
    progress(1.0, "Order done")
    update(project=slug, step="Order done", step_index=n, steps_total=n)
    return pipeline.summary(slug)
