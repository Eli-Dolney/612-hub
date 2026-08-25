"""The Grok studio on this Mac. Paths are next to Hub on the Desktop."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

from server.config import DESKTOP


@dataclass(frozen=True)
class AppSpec:
    id: str
    name: str
    short: str
    folder: str
    blurb: str
    category: str
    vs: str
    color: str
    ui_port: int
    api_port: Optional[int]
    health_path: str
    launch: str  # "run.sh" or "npm"
    projects: tuple[str, ...]
    step: str

    @property
    def path(self) -> Path:
        return DESKTOP / self.folder

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.ui_port}"

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["path"] = str(self.path)
        data["url"] = self.url
        return data


APPS: tuple[AppSpec, ...] = (
    AppSpec(
        id="pull",
        name="GrokPull",
        short="PL",
        folder="grok-pull",
        blurb="Probe-first downloader. YouTube 4K/HDR, playlists, Watch player.",
        category="Capture",
        vs="LTW Downloader",
        color="#2dd4bf",
        ui_port=5175,
        api_port=8788,
        health_path="/api/health",
        launch="run.sh",
        projects=("downloads",),
        step="Capture",
    ),
    AppSpec(
        id="harvest",
        name="GrokHarvest",
        short="HV",
        folder="grok-harvest",
        blurb="Scout free B-roll, keep the shots, pull only those.",
        category="B-roll",
        vs="Clip Harvester",
        color="#34d399",
        ui_port=5179,
        api_port=8791,
        health_path="/api/health",
        launch="run.sh",
        projects=("projects",),
        step="Scout",
    ),
    AppSpec(
        id="voice",
        name="GrokVoice",
        short="VO",
        folder="grok-voice",
        blurb="Local cloned narration, scripts, and multi-speaker stories.",
        category="Voice",
        vs="TTS-MAc",
        color="#38bdf8",
        ui_port=5178,
        api_port=8790,
        health_path="/api/health",
        launch="run.sh",
        projects=("shows", "voices"),
        step="Narrate",
    ),
    AppSpec(
        id="mix",
        name="GrokMix",
        short="MX",
        folder="grok-mix",
        blurb="Demucs stems, analysis, and live Strudel remixes.",
        category="Audio",
        vs="LTW Audio",
        color="#5eead4",
        ui_port=5177,
        api_port=8789,
        health_path="/api/health",
        launch="run.sh",
        projects=("projects",),
        step="Stems",
    ),
    AppSpec(
        id="clip",
        name="GrokClip",
        short="CL",
        folder="grok-clip",
        blurb="Transcript-first shorts. Keep the lines, export a bundle.",
        category="Cut",
        vs="LTW Splitter",
        color="#f5a524",
        ui_port=5180,
        api_port=8792,
        health_path="/api/health",
        launch="run.sh",
        projects=("projects",),
        step="Cut",
    ),
    AppSpec(
        id="edit",
        name="GrokEdit",
        short="ED",
        folder="grok",
        blurb="Thumbnails and photos in the browser. Object layers, no cloud.",
        category="Design",
        vs="LTW EzEdit",
        color="#fb7185",
        ui_port=5174,
        api_port=None,
        health_path="/",
        launch="npm",
        projects=(),
        step="Thumb",
    ),
    AppSpec(
        id="play",
        name="GrokPlay",
        short="LS",
        folder="grok-play",
        blurb="Local listening room. Waveform, EQ, mixes from play counts.",
        category="Listen",
        vs="MUSIC_UI",
        color="#c084fc",
        ui_port=5176,
        api_port=None,
        health_path="/",
        launch="npm",
        projects=(),
        step="Listen",
    ),
)

PIPELINE = ("pull", "harvest", "voice", "mix", "clip", "edit")


def get_app(app_id: str) -> AppSpec:
    for spec in APPS:
        if spec.id == app_id:
            return spec
    raise KeyError(app_id)
