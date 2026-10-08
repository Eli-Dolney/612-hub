"""FCPXML 1.9 that DaVinci Resolve can import as bins."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from server.engine.io_util import load_candidates, project_dir
from server.engine.models import Candidate, Project


def write_fcpxml(project: Project, rows: list[Candidate] | None = None) -> Path:
    rows = rows if rows is not None else load_candidates(project.slug)
    pulled = [r for r in rows if r.pulled and r.file_path and Path(r.file_path).is_file()]
    root_dir = project_dir(project.slug)

    fcpxml = ET.Element("fcpxml", version="1.9")
    resources = ET.SubElement(fcpxml, "resources")
    format_el = ET.SubElement(
        resources,
        "format",
        id="r0",
        name="FFVideoFormat1080p30",
        frameDuration="1001/30000s",
        width="1920",
        height="1080",
        colorSpace="1-1-1 (Rec. 709)",
    )
    del format_el

    for index, row in enumerate(pulled, start=1):
        path = Path(row.file_path)
        if not path.is_absolute():
            path = root_dir / path
        src = path.resolve().as_uri()
        ET.SubElement(
            resources,
            "asset",
            id=f"a{index}",
            name=path.name,
            src=src,
            hasVideo="1",
            format="r0",
        )

    library = ET.SubElement(fcpxml, "library")
    event = ET.SubElement(library, "event", name=project.name)
    by_section: dict[str, list[tuple[int, Candidate]]] = {}
    for index, row in enumerate(pulled, start=1):
        by_section.setdefault(row.section_slug or "bin", []).append((index, row))

    for section in project.sections:
        items = by_section.get(section.slug) or []
        if not items:
            continue
        smart = ET.SubElement(event, "project", name=section.title)
        sequence = ET.SubElement(smart, "sequence", format="r0", tcStart="0s")
        spine = ET.SubElement(sequence, "spine")
        offset = 0
        for index, row in items:
            duration = 150150  # ~5s at 30000/1001
            clip = ET.SubElement(
                spine,
                "asset-clip",
                name=Path(row.file_path).name,
                ref=f"a{index}",
                offset=f"{offset}/30000s",
                duration=f"{duration}/30000s",
                start="0s",
                format="r0",
            )
            del clip
            offset += duration

    # leftover files without a matching section
    leftovers = [pair for slug, items in by_section.items() if slug not in {s.slug for s in project.sections} for pair in items]
    if leftovers:
        smart = ET.SubElement(event, "project", name="Unsorted")
        sequence = ET.SubElement(smart, "sequence", format="r0", tcStart="0s")
        spine = ET.SubElement(sequence, "spine")
        offset = 0
        for index, row in leftovers:
            duration = 150150
            ET.SubElement(
                spine,
                "asset-clip",
                name=Path(row.file_path).name,
                ref=f"a{index}",
                offset=f"{offset}/30000s",
                duration=f"{duration}/30000s",
                start="0s",
                format="r0",
            )
            offset += duration

    tree = ET.ElementTree(fcpxml)
    ET.indent(tree, space="  ")
    path = root_dir / "resolve.fcpxml"
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return path
