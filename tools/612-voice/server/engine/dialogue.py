from __future__ import annotations

import re

from server.config import SPEAKERS

LABEL = re.compile(
    r"^\s*(?:\[(?P<bracket>[A-D1-4])\]|(?:speaker\s*)?(?P<name>[A-Za-z][A-Za-z0-9_-]{0,24}|[1-4]))\s*:\s*(?P<text>.+?)\s*$",
    re.I,
)


def _canon(raw: str) -> str:
    token = raw.strip().upper()
    if token in {"1", "SPEAKER1", "SPEAKER_1", "SPEAKER-1"}:
        return "A"
    if token in {"2", "SPEAKER2", "SPEAKER_2", "SPEAKER-2"}:
        return "B"
    if token in {"3", "SPEAKER3", "SPEAKER_3", "SPEAKER-3"}:
        return "C"
    if token in {"4", "SPEAKER4", "SPEAKER_4", "SPEAKER-4"}:
        return "D"
    if token in SPEAKERS:
        return token
    if token.startswith("SPEAKER"):
        tail = token.replace("SPEAKER", "").strip("_- ")
        return _canon(tail or "A")
    # Named hosts collapse into A–D by first-seen order in parse_dialogue.
    return token


def parse_dialogue(text: str) -> list[dict[str, str]]:
    """Turn Speaker 1: / A: labeled lines into [{speaker, text}]."""
    rows: list[dict[str, str]] = []
    aliases: dict[str, str] = {}
    used: set[str] = set()

    def assign(token: str) -> str:
        if token in SPEAKERS:
            used.add(token)
            return token
        if token not in aliases:
            for slot in SPEAKERS:
                if slot not in used:
                    aliases[token] = slot
                    used.add(slot)
                    break
            else:
                aliases[token] = SPEAKERS[-1]
        slot = aliases[token]
        used.add(slot)
        return slot

    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        match = LABEL.match(line)
        if match:
            key = match.group("bracket") or match.group("name") or "A"
            canon = assign(_canon(key))
            rows.append({"speaker": canon, "text": match.group("text").strip()})
        elif rows:
            rows[-1]["text"] = (rows[-1]["text"] + " " + line).strip()
        else:
            rows.append({"speaker": "A", "text": line})
    return [row for row in rows if row["text"]]
