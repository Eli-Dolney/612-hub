"""Orchestrate probe, Demucs split, analysis, and Strudel generation."""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import librosa
import numpy as np

from server.config import (
    APP_VERSION,
    PROJECTS_DIR,
    SAMPLE_RATE,
    STEM_METHOD_DEFAULT,
    SUPPORTED_FORMATS,
)
from server.engine.app_helpers import (
    build_analysis_data_for_strudel,
    get_stem_audio_for_analysis,
    get_stem_paths_from_config,
    load_all_analysis_results,
    load_stems_from_project,
    merge_beat_summary,
    safe_extract_melody,
)
from server.engine.chords import analyze_chord_progression, detect_key_from_chroma
from server.engine.drums import extract_drums_to_midi
from server.engine.io_utils import (
    ProjectManager,
    get_midi_path,
    get_stem_path,
    load_audio_file,
    save_analysis_results,
    save_audio_file,
)
from server.engine.remix_engine import (
    LAYER_SOUND_PRESETS,
    REMIX_PRESETS,
    render_custom_remix,
)
from server.engine.separation import StemSeparator, _get_demucs_device, get_available_methods
from server.engine.strudel_integration import StrudelPatternGenerator, generate_strudel_from_analysis
from server.engine.timing import create_beat_grid

ProgressFn = Callable[[float, str], None]


def device_name() -> str:
    try:
        return _get_demucs_device()
    except Exception:
        return "cpu"


def safe_project_name(raw: str) -> str:
    stem = Path(raw).stem
    cleaned = re.sub(r"[^\w\s-]", "", stem, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", "_", cleaned).strip("_")
    return (cleaned[:80] or "untitled")


def unique_name(name: str) -> str:
    candidate = name
    n = 2
    while (PROJECTS_DIR / candidate).exists():
        candidate = f"{name}_{n}"
        n += 1
    return candidate


def waveform_peaks(audio: np.ndarray, buckets: int = 720) -> list[float]:
    if audio.size == 0:
        return [0.0] * buckets
    hop = max(1, audio.size // buckets)
    peaks: list[float] = []
    for i in range(buckets):
        chunk = audio[i * hop : (i + 1) * hop]
        peaks.append(float(np.max(np.abs(chunk))) if chunk.size else 0.0)
    peak = max(peaks) or 1.0
    return [p / peak for p in peaks]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_path(project: ProjectManager, config: dict[str, Any]) -> Path:
    audio = config.get("audio") or {}
    path = audio.get("path")
    if path:
        p = Path(path)
        if p.exists():
            return p
        local = project.project_path / p.name
        if local.exists():
            return local
    for pattern in ("source.*", "*.wav", "*.mp3", "*.flac", "*.m4a", "*.aac"):
        hits = list(project.project_path.glob(pattern))
        files = [h for h in hits if h.is_file() and h.suffix.lower() in SUPPORTED_FORMATS]
        if files:
            return files[0]
    raise FileNotFoundError("No source audio in this project")


def _probe_payload(audio: np.ndarray, sr: int) -> dict[str, Any]:
    duration = float(len(audio) / sr)
    clip = audio[: int(sr * min(45, duration))]
    tempo, _ = librosa.beat.beat_track(y=clip, sr=sr)
    if isinstance(tempo, np.ndarray):
        tempo = float(tempo.item())
    else:
        tempo = float(tempo)
    return {
        "duration": duration,
        "sr": int(sr),
        "tempo_guess": tempo,
        "peaks": waveform_peaks(audio),
    }


def create_project_from_upload(src: Path, requested_name: Optional[str] = None) -> dict[str, Any]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    name = unique_name(safe_project_name(requested_name or src.name))
    project = ProjectManager(name)
    dest = project.project_path / f"source{src.suffix.lower()}"
    shutil.copy2(src, dest)

    audio, sr = load_audio_file(dest)
    probe = _probe_payload(audio, sr)
    (project.analysis_path / "probe.json").write_text(json.dumps(probe))

    config = {
        "audio": {
            "path": str(dest),
            "filename": src.name,
            "sr": sr,
            "duration": probe["duration"],
        },
        "stems": {},
        "analysis": {"tempo": probe["tempo_guess"]},
        "status": "probed",
        "created_at": _now(),
        "version": APP_VERSION,
    }
    project.save_project_config(config)
    return project_summary(name)


def project_summary(name: str) -> dict[str, Any]:
    project = ProjectManager(name)
    config = project.load_project_config() or {}
    audio = config.get("audio") or {}
    analysis = config.get("analysis") or {}
    stems = get_stem_paths_from_config(config, project)
    strudel_dir = project.project_path / "strudel"
    probe_file = project.analysis_path / "probe.json"
    peaks: list[float] = []
    tempo_guess = analysis.get("tempo")
    if probe_file.exists():
        try:
            probe = json.loads(probe_file.read_text())
            peaks = probe.get("peaks") or []
            tempo_guess = tempo_guess or probe.get("tempo_guess")
        except Exception:
            pass

    analysis_files = []
    if project.analysis_path.exists():
        analysis_files = [p.stem for p in project.analysis_path.glob("*.json")]

    patterns = []
    if strudel_dir.exists():
        patterns = sorted(p.name for p in strudel_dir.glob("*.js"))

    source = None
    for hit in project.project_path.glob("source.*"):
        if hit.is_file():
            source = hit.name
            break

    return {
        "name": name,
        "filename": audio.get("filename") or Path(audio.get("path", "")).name,
        "source": source,
        "duration": audio.get("duration"),
        "sr": audio.get("sr"),
        "tempo": analysis.get("tempo") or tempo_guess,
        "key": analysis.get("key_guess"),
        "status": config.get("status") or "loaded",
        "stems": sorted(stems.keys()),
        "analysis": sorted(set(analysis_files) - {"probe", "strudel_blocks"}),
        "patterns": patterns,
        "peaks": peaks,
        "created_at": config.get("created_at"),
        "has_stems": bool(stems),
        "has_analysis": "tempo_beats" in analysis_files,
        "has_strudel": "building_blocks.js" in patterns,
    }


def list_project_summaries() -> list[dict[str, Any]]:
    if not PROJECTS_DIR.exists():
        return []
    items = []
    for folder in sorted(PROJECTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if folder.is_dir() and (folder / "project.ltw.json").exists():
            try:
                items.append(project_summary(folder.name))
            except Exception:
                continue
    return items


def delete_project(name: str) -> None:
    path = (PROJECTS_DIR / name).resolve()
    if PROJECTS_DIR.resolve() not in path.parents and path != PROJECTS_DIR.resolve():
        raise ValueError("Invalid project path")
    if path.exists():
        shutil.rmtree(path)


def project_detail(name: str) -> dict[str, Any]:
    marker = PROJECTS_DIR / name / "project.ltw.json"
    if not marker.exists():
        raise FileNotFoundError(name)
    summary = project_summary(name)
    project = ProjectManager(name)
    results = load_all_analysis_results(project)
    tempo_beats = results.get("tempo_beats") or {}
    drums = results.get("drums") or {}
    melody = results.get("melody") or {}
    bass = results.get("bass") or {}
    chords = results.get("chords") or {}

    codes: dict[str, str] = {}
    strudel_dir = project.project_path / "strudel"
    if strudel_dir.exists():
        for js in sorted(strudel_dir.glob("*.js")):
            try:
                codes[js.name] = js.read_text()
            except Exception:
                continue

    labels = chords.get("chord_labels") or []
    return {
        **summary,
        "total_beats": tempo_beats.get("total_beats"),
        "time_signature": tempo_beats.get("time_signature"),
        "drum_hits": drums.get("total_hits") or len(drums.get("hits") or drums.get("onset_times") or []),
        "drum_distribution": drums.get("drum_distribution") or {},
        "melody_notes": (melody.get("statistics") or {}).get("total_notes") or len(melody.get("notes") or []),
        "bass_notes": (bass.get("statistics") or {}).get("total_notes") or len(bass.get("notes") or []),
        "chord_labels": labels[:24],
        "total_chords": chords.get("total_chords") or len(labels),
        "codes": codes,
        "presets": remix_preset_list(),
        "sounds": {layer: list(opts.keys()) for layer, opts in LAYER_SOUND_PRESETS.items()},
    }


def remix_preset_list() -> list[dict[str, str]]:
    return [
        {"id": pid, "name": spec["name"], "emoji": spec.get("emoji", "")}
        for pid, spec in REMIX_PRESETS.items()
    ]


def split_project(name: str, method: str = STEM_METHOD_DEFAULT, progress: Optional[ProgressFn] = None) -> dict[str, Any]:
    emit = progress or (lambda *_: None)
    emit(0.05, "Loading source")
    project = ProjectManager(name)
    config = project.load_project_config() or {}
    src = _source_path(project, config)
    audio, sr = load_audio_file(src)
    emit(0.12, f"Demucs on {device_name()}")
    separator = StemSeparator(method)
    emit(0.2, "Separating stems (this is the slow step)")
    stems = separator.separate_audio(audio, sr)
    emit(0.85, "Writing stem WAVs")
    stem_paths = {}
    for stem_name, stem_audio in stems.items():
        path = get_stem_path(project, stem_name)
        save_audio_file(stem_audio, path, sr)
        stem_paths[stem_name] = str(path)
    config["stems"] = {"method": method, "paths": stem_paths}
    config["status"] = "split"
    project.save_project_config(config)
    emit(1.0, "Stems ready")
    return project_summary(name)


def analyze_project(name: str, progress: Optional[ProgressFn] = None) -> dict[str, Any]:
    emit = progress or (lambda *_: None)
    project = ProjectManager(name)
    config = project.load_project_config() or {}
    src = _source_path(project, config)
    emit(0.05, "Loading audio")
    audio, sr = load_audio_file(src)
    stems = load_stems_from_project(project)
    results: dict[str, Any] = {}

    emit(0.12, "Tempo & beats")
    tempo = create_beat_grid(audio, sr)
    save_analysis_results(project, "tempo_beats", tempo)
    results["tempo_beats"] = tempo
    beat_times = tempo.get("beat_times")

    emit(0.32, "Drums")
    drums = extract_drums_to_midi(
        get_stem_audio_for_analysis("drums", stems, audio, project),
        sr,
        str(get_midi_path(project, "drums_basic")),
        confidence_threshold=0.35,
    )
    save_analysis_results(project, "drums", drums)
    results["drums"] = drums

    emit(0.52, "Melody (pYIN)")
    melody = safe_extract_melody(
        get_stem_audio_for_analysis("melody", stems, audio, project),
        sr,
        str(get_midi_path(project, "melody")),
        beat_times=beat_times,
    )
    save_analysis_results(project, "melody", melody)
    results["melody"] = melody

    emit(0.72, "Bass (pYIN)")
    bass = safe_extract_melody(
        get_stem_audio_for_analysis("bass", stems, audio, project),
        sr,
        str(get_midi_path(project, "bass")),
        beat_times=beat_times,
    )
    save_analysis_results(project, "bass", bass)
    results["bass"] = bass

    emit(0.88, "Chords & key")
    chord_audio = get_stem_audio_for_analysis("chords", stems, audio, project)
    chords = analyze_chord_progression(chord_audio, sr)
    chroma = np.array(chords.get("chroma_features") or [])
    if chroma.size:
        key, key_conf = detect_key_from_chroma(chroma)
    else:
        key, key_conf = "C", 0.0
    chords["key"] = key
    chords["key_confidence"] = key_conf
    save_analysis_results(project, "chords", chords)
    results["chords"] = chords

    config = project.load_project_config() or config
    merge_beat_summary(config, tempo)
    config.setdefault("analysis", {})
    config["analysis"]["key_guess"] = key
    config["analysis"]["key_confidence"] = float(key_conf)
    config["status"] = "analyzed"
    project.save_project_config(config)
    emit(1.0, "Analysis complete")
    return project_summary(name)


def generate_strudel(name: str, progress: Optional[ProgressFn] = None) -> dict[str, Any]:
    emit = progress or (lambda *_: None)
    project = ProjectManager(name)
    emit(0.1, "Loading analysis")
    results = load_all_analysis_results(project)
    if "tempo_beats" not in results:
        raise RuntimeError("Run analysis before generating Strudel")
    analysis_data = build_analysis_data_for_strudel(project, results)
    config = project.load_project_config() or {}
    stem_paths = get_stem_paths_from_config(config, project)
    emit(0.35, "Writing building blocks, remixes, slices")
    files = generate_strudel_from_analysis(
        analysis_data,
        str(project.project_path / "strudel"),
        project_path=str(project.project_path),
        project_name=project.project_name,
        stem_paths=stem_paths,
    )
    gen = StrudelPatternGenerator()
    blocks = gen._extract_blocks(analysis_data)
    (project.analysis_path / "strudel_blocks.json").write_text(json.dumps(blocks, default=str))
    config = project.load_project_config() or {}
    config["status"] = "strudel"
    config["strudel_files"] = {k: str(v) for k, v in files.items()}
    project.save_project_config(config)
    emit(1.0, "Strudel ready")
    return project_summary(name)


def run_pipeline(name: str, method: str = STEM_METHOD_DEFAULT, progress: Optional[ProgressFn] = None) -> dict[str, Any]:
    emit = progress or (lambda *_: None)

    def mapped(lo: float, hi: float):
        def inner(p: float, msg: str) -> None:
            emit(lo + (hi - lo) * p, msg)
        return inner

    split_project(name, method, mapped(0.0, 0.42))
    analyze_project(name, mapped(0.42, 0.84))
    generate_strudel(name, mapped(0.84, 1.0))
    return project_summary(name)


def custom_remix(
    name: str,
    preset_id: str = "phat_analog",
    enabled_layers: Optional[list[str]] = None,
    layer_sounds: Optional[dict[str, str]] = None,
    intensity: float = 0.0,
    seed: Optional[int] = None,
) -> dict[str, str]:
    project = ProjectManager(name)
    blocks_path = project.analysis_path / "strudel_blocks.json"
    if blocks_path.exists():
        blocks = json.loads(blocks_path.read_text())
    else:
        results = load_all_analysis_results(project)
        if "tempo_beats" not in results:
            raise RuntimeError("Analyze and generate Strudel first")
        analysis_data = build_analysis_data_for_strudel(project, results)
        blocks = StrudelPatternGenerator()._extract_blocks(analysis_data)
    code = render_custom_remix(
        blocks,
        global_preset_id=preset_id,
        layer_sounds=layer_sounds,
        enabled_layers=enabled_layers,
        intensity=intensity,
        seed=seed,
    )
    out = project.project_path / "strudel" / "custom_remix.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(code)
    return {"filename": out.name, "code": code}


def resolve_media(name: str, rel: str) -> Path:
    project = ProjectManager(name)
    root = project.project_path.resolve()
    target = (root / rel).resolve()
    if root not in target.parents and target != root:
        raise ValueError("Path escapes project")
    if not target.is_file():
        raise FileNotFoundError(rel)
    return target


def resolve_slice(name: str, stem: str, filename: str) -> Path:
    return resolve_media(name, str(Path("slices") / stem / filename))
