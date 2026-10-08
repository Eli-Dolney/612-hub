"""Pull search queries from a raw narration script."""

from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

from server.engine.models import Project, Section, Shot, new_id

STOP = {
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "those", "these",
    "to", "of", "in", "on", "for", "with", "as", "at", "by", "from", "into", "about", "over", "after",
    "it", "its", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "not", "no",
    "so", "very", "can", "could", "should", "would", "may", "might", "must", "we", "you", "they",
    "he", "she", "i", "me", "my", "our", "your", "their", "them", "his", "her", "there", "here",
    "how", "what", "when", "where", "why", "which", "who", "will", "just", "also", "like", "one",
    "two", "three", "many", "much", "more", "most", "some", "any", "all", "have", "has", "had",
    "get", "got", "make", "made", "know", "think", "say", "said", "tell", "today", "want", "lets",
}


def _dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key.lower() in seen:
            continue
        seen.add(key.lower())
        out.append(key)
    return out


def _headings(text: str) -> list[str]:
    results: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            title = line.lstrip("#").strip()
            if title:
                results.append(title)
            continue
        words = [w for w in re.findall(r"[A-Za-z0-9']+", line) if w]
        if not words or len(words) > 10:
            continue
        upper = sum(1 for w in words if w[0].isupper())
        if upper / max(1, len(words)) >= 0.7 and any(len(w) > 2 for w in words):
            results.append(line)
    return _dedupe(results)


def extract_queries(text: str, max_total: int = 22) -> list[str]:
    tokens = [t.lower() for t in re.findall(r"[A-Za-z0-9']+", text)]
    tokens = [t for t in tokens if t not in STOP and len(t) >= 3]
    bigrams = [f"{tokens[i]} {tokens[i + 1]}" for i in range(len(tokens) - 1)]
    trigrams = [f"{tokens[i]} {tokens[i + 1]} {tokens[i + 2]}" for i in range(max(0, len(tokens) - 2))]
    counts = Counter(bigrams + trigrams)
    ranked = [phrase.title() for phrase, _ in sorted(counts.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))]
    keywords = [w.title() for w, _ in Counter(t for t in tokens if len(t) >= 4).most_common(10)]
    return _dedupe([*_headings(text), *ranked, *keywords])[:max_total]


def _category(query: str) -> str:
    lower = query.lower()
    if any(k in lower for k in ["map", "chart", "timeline", "graph", "animation", "infographic"]):
        return "motion"
    if any(k in lower for k in ["news", "headline", "screenshot", "text"]):
        return "screenshot"
    return "stock"


def parse_script(text: str, project_name: str = "Untitled reel") -> Project:
    queries = extract_queries(text) or ["Documentary b-roll"]
    shots = [Shot(id=new_id(), query=q, category=_category(q), harvest=True) for q in queries]
    section = Section(title="Script queries", slug="01_script-queries", order=1, shots=shots)
    return Project.create(project_name, "script", text, [section])
