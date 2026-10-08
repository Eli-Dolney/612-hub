"""Clean and expand documentary search queries."""

from __future__ import annotations

import re
from typing import Iterable

FILLER = re.compile(
    r"\b(footage|b-?roll|clips?|videos?|shots?|images?|photos?|pictures?|of|the|a|an)\b",
    re.I,
)

EXPAND: dict[str, list[str]] = {
    "news studio": ["broadcast newsroom", "tv news desk"],
    "newsroom": ["broadcast studio", "news anchor desk"],
    "breaking news": ["news ticker", "news headline graphic"],
    "lower third": ["broadcast lower third", "news graphic overlay"],
    "world map": ["political world map", "earth globe"],
    "globe": ["rotating earth", "world globe"],
    "microscope": ["laboratory microscope", "science lab bench"],
    "virus": ["virus under microscope", "pathogen cells"],
    "mouse": ["deer mouse", "field mouse rodent"],
    "farmhouse": ["rural farm house dusk", "countryside barn"],
    "airport": ["airport terminal concourse", "airliner taking off"],
    "router": ["wifi router lights", "home internet modem"],
    "server": ["data center servers", "network rack"],
    "cables": ["ethernet cables", "server room cables"],
    "hospital": ["hospital corridor", "emergency room"],
    "lab": ["research laboratory", "scientist pipette"],
    "city night": ["city skyline night", "urban traffic night"],
    "protest": ["street protest crowd", "march demonstration"],
    "satellite": ["earth from space", "satellite dish"],
    "keyboard": ["programmer typing keyboard", "code on monitor"],
}


def _dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = re.sub(r"\s+", " ", item).strip()
        if not key or key.lower() in seen:
            continue
        seen.add(key.lower())
        out.append(key)
    return out


def clean_query(query: str) -> str:
    text = re.sub(r"[\"'`]+", "", query).strip()
    text = re.sub(r"\s+", " ", text)
    stripped = FILLER.sub(" ", text)
    stripped = re.sub(r"\s+", " ", stripped).strip(" -/,")
    return stripped or text


def expand_query(query: str, enabled: bool = True) -> list[str]:
    cleaned = clean_query(query)
    variants = [cleaned]
    if cleaned.lower() != query.strip().lower():
        variants.insert(0, query.strip())
    if enabled:
        lower = cleaned.lower()
        for key, extras in EXPAND.items():
            if key in lower:
                variants.extend(extras)
                break
    return _dedupe(variants)[:3]
