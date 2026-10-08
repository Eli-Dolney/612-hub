"""YouTube-ready stock credits from kept/pulled clips."""

from __future__ import annotations

from collections import defaultdict

from server.engine.io_util import load_candidates, project_dir
from server.engine.models import Candidate, Project


def credit_lines(rows: list[Candidate], include_unpulled: bool = True) -> list[str]:
    chosen = [r for r in rows if r.kept or r.pulled]
    if not chosen and include_unpulled:
        chosen = rows
    grouped: dict[str, list[Candidate]] = defaultdict(list)
    seen: set[str] = set()
    for row in chosen:
        key = f"{row.provider}:{row.id}"
        if key in seen:
            continue
        seen.add(key)
        grouped[row.provider].append(row)

    lines = ["Stock footage & images"]
    if not grouped:
        lines.append("None yet — keep clips in 612 Harvest first.")
        return lines

    for provider, items in grouped.items():
        lines.append("")
        lines.append(provider.title())
        for row in items:
            who = f" — {row.author}" if row.author else ""
            url = f" — {row.source_url}" if row.source_url else ""
            lines.append(f"{row.query or 'clip'}{who}{url} ({row.license or 'see source'})")
    return lines


def write_credits(project: Project, rows: list[Candidate] | None = None) -> str:
    rows = rows if rows is not None else load_candidates(project.slug)
    text = "\n".join(credit_lines(rows)) + "\n"
    path = project_dir(project.slug) / "credits.txt"
    path.write_text(text, encoding="utf-8")
    md = ["# Credits", "", "```", text.strip(), "```", ""]
    (project_dir(project.slug) / "credits.md").write_text("\n".join(md), encoding="utf-8")
    return text
