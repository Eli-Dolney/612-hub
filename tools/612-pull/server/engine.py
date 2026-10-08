"""yt-dlp engine: probe, format listing, and download with progress."""

from __future__ import annotations

import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from yt_dlp import YoutubeDL
from .artwork import attach_artwork, enable_artwork_options

# GUI/Cursor-spawned processes often lack Homebrew on PATH.
for _bin in ("/opt/homebrew/bin", "/usr/local/bin"):
    if _bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

ProgressFn = Callable[[dict[str, Any]], None]
StopFn = Callable[[], bool]

UNSUPPORTED_DRM_DOMAINS = (
    "netflix.com",
    "disneyplus.com",
    "hulu.com",
    "primevideo.com",
    "amazonprimevideo.com",
    "max.com",
    "hbomax.com",
    "tv.apple.com",
    "paramountplus.com",
    "peacocktv.com",
    "starz.com",
    "showtime.com",
    "crunchyroll.com",
    "funimation.com",
    "vrv.co",
    "tubitv.com",
    "plutotv.com",
    "kanopy.org",
    "hoopla.com",
    "spotify.com",
)

PLATFORM_HINTS = {
    "youtube.com": {"name": "YouTube", "max": "8K", "kind": "video"},
    "youtu.be": {"name": "YouTube", "max": "8K", "kind": "video"},
    "music.youtube.com": {"name": "YouTube Music", "max": "audio", "kind": "audio"},
    "tiktok.com": {"name": "TikTok", "max": "1080p", "kind": "video"},
    "instagram.com": {"name": "Instagram", "max": "1080p", "kind": "video"},
    "twitter.com": {"name": "X", "max": "1080p", "kind": "video"},
    "x.com": {"name": "X", "max": "1080p", "kind": "video"},
    "soundcloud.com": {"name": "SoundCloud", "max": "audio", "kind": "audio"},
    "on.soundcloud.com": {"name": "SoundCloud", "max": "audio", "kind": "audio"},
    "bandcamp.com": {"name": "Bandcamp", "max": "audio", "kind": "audio"},
    "vimeo.com": {"name": "Vimeo", "max": "4K", "kind": "video"},
    "dailymotion.com": {"name": "Dailymotion", "max": "1080p", "kind": "video"},
    "twitch.tv": {"name": "Twitch", "max": "1080p", "kind": "video"},
    "clips.twitch.tv": {"name": "Twitch", "max": "1080p", "kind": "video"},
    "reddit.com": {"name": "Reddit", "max": "1080p", "kind": "video"},
}

VIDEO_QUALITY = [
    "Best Available",
    "8K",
    "4K HDR",
    "4K / 2160p",
    "1440p",
    "1080p",
    "720p",
    "Social / Fast",
    "480p",
    "360p",
]

AUDIO_QUALITY = [
    "Best (original)",
    "320kbps",
    "256kbps",
    "192kbps",
    "128kbps",
    "96kbps",
    "64kbps",
]

CONTAINERS = ["Auto", "MP4", "MKV", "WebM"]
BROWSERS = ["None", "Chrome", "Safari", "Firefox", "Edge", "Brave"]

URL_RE = re.compile(r"https?://[^\s<>\"'`]+", re.I)

HEIGHT_CAPS = {
    "Best Available": None,
    "4K / 2160p": 2160,
    "4K HDR": 2160,
    "8K": 4320,
    "1440p": 1440,
    "1080p": 1080,
    "720p": 720,
    "Social / Fast": 720,
    "480p": 480,
    "360p": 360,
}

YOUTUBE_IDS = frozenset({"youtube.com", "youtu.be", "music.youtube.com"})
MEDIA_FILE_EXT = {
    ".mkv",
    ".mp4",
    ".webm",
    ".mov",
    ".m4v",
    ".m4a",
    ".mp3",
    ".opus",
    ".ogg",
    ".flac",
    ".wav",
    ".aac",
    ".mka",
}
IMAGE_FILE_EXT = {".webp", ".jpg", ".jpeg", ".png", ".gif", ".bmp"}
JUNK_SUFFIXES = (".part", ".ytdl", ".temp", ".tmp")


def extract_urls(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in URL_RE.findall(text or ""):
        url = match.rstrip(").,]}>\"'")
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def detect_platform(url: str) -> dict[str, str]:
    try:
        host = (urlparse(url).netloc or "").lower()
    except Exception:
        return {"id": "unknown", "name": "Web", "max": "?", "kind": "video"}
    hits = [(domain, meta) for domain, meta in PLATFORM_HINTS.items() if domain in host]
    if hits:
        domain, meta = max(hits, key=lambda item: len(item[0]))
        return {"id": domain, **meta}
    return {"id": "unknown", "name": "Web", "max": "?", "kind": "video"}


def is_drm_url(url: str) -> bool:
    try:
        host = (urlparse(url).netloc or "").lower()
    except Exception:
        return False
    return any(d in host for d in UNSUPPORTED_DRM_DOMAINS)


def is_youtube(platform_id: str) -> bool:
    return platform_id in YOUTUBE_IDS


def canonicalize_youtube_url(url: str) -> str:
    """music.youtube.com watch/playlist pages extract more reliably on www.youtube.com."""
    try:
        parsed = urlparse(url.strip())
        host = (parsed.netloc or "").lower()
        if "music.youtube.com" not in host:
            return url
        path = parsed.path or ""
        query = parse_qs(parsed.query, keep_blank_values=True)
        if "/watch" in path and query.get("v") and query["v"][0]:
            extra = {k: v for k, v in query.items() if k != "v"}
            new_q = urlencode({"v": query["v"][0], **extra}, doseq=True)
            return urlunparse(("https", "www.youtube.com", "/watch", "", new_q, ""))
        if "playlist" in path and query.get("list") and query["list"][0]:
            new_q = urlencode({"list": query["list"][0]}, doseq=True)
            return urlunparse(("https", "www.youtube.com", "/playlist", "", new_q, ""))
    except Exception:
        return url
    return url


def youtube_strip_playlist(url: str) -> str:
    try:
        parsed = urlparse(url.strip())
        host = (parsed.netloc or "").lower()
        path = (parsed.path or "").lower()
        query = parse_qs(parsed.query, keep_blank_values=True)
        strip = False
        if host.endswith("youtu.be"):
            strip = True
        elif "youtube.com" in host or "youtube-nocookie.com" in host:
            if "/watch" in path or "/live/" in path:
                strip = bool(query.get("v") and query["v"][0])
        if not strip:
            return url
        for key in ("list", "index", "start_radio", "pp"):
            query.pop(key, None)
        new_q = urlencode(query, doseq=True)
        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_q, parsed.fragment))
    except Exception:
        return url


def js_runtimes() -> dict[str, Any]:
    node = shutil.which("node")
    if node:
        return {"node": {"path": node}}
    deno = shutil.which("deno")
    if deno:
        return {"deno": {"path": deno}}
    return {"deno": {}}


def pot_base_url() -> str:
    return (os.environ.get("YTDLP_POT_BASE_URL") or "http://127.0.0.1:4416").rstrip("/")


def pot_ready() -> bool:
    try:
        from urllib.request import urlopen

        with urlopen(f"{pot_base_url()}/ping", timeout=1.5) as res:
            return res.status == 200
    except Exception:
        return False


def which_tools() -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    node = shutil.which("node")
    version = "?"
    try:
        import yt_dlp

        version = yt_dlp.version.__version__
    except Exception:
        pass
    return {
        "ffmpeg": bool(ffmpeg),
        "ffprobe": bool(ffprobe),
        "node": bool(node),
        "pot": pot_ready(),
        "ytdlp": version,
        "python": sys.version.split()[0],
    }


def safe_component(name: str) -> str:
    if not isinstance(name, str):
        name = str(name)
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = name.strip().strip(".")
    name = re.sub(r"[\s_]+", " ", name).strip()
    return name or "unknown"


def apply_cookies(opts: dict[str, Any], settings: dict[str, Any]) -> None:
    browser = (settings.get("cookies_browser") or "None").strip()
    if browser and browser.lower() != "none":
        opts["cookiesfrombrowser"] = (browser.lower(),)
        return
    cookie_file = (settings.get("cookie_file") or "").strip()
    if cookie_file and os.path.isfile(cookie_file):
        opts["cookiefile"] = cookie_file


def base_opts(settings: dict[str, Any]) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "outtmpl_na_placeholder": "unknown",
        "retries": 8,
        "fragment_retries": 8,
        "skip_unavailable_fragments": True,
        "socket_timeout": 30,
        "concurrent_fragment_downloads": 3,
        "http_chunk_size": 2_097_152,
        "ignoreerrors": "only_download",
        "overwrites": True,
        "js_runtimes": js_runtimes(),
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        "extractor_args": {
            "youtubepot-bgutilhttp": {"base_url": [pot_base_url()]},
            "youtube": {"comment_sort": ["top"], "max_comments": [0]},
            "tiktok": {
                "webpage_download": True,
                "api_hostname": "api-h2.tiktokv.com",
                "app_version": "29.0.0",
                "manifest_app_version": "29.0.0",
            },
            "soundcloud": {"max_comments": [0]},
        },
    }
    apply_cookies(opts, settings)
    return opts


def format_sort_for_video(label: str) -> list[str]:
    sorts: list[str] = []
    if label == "4K HDR":
        sorts.extend(["dynamic_range:hdr", "res:2160"])
    elif label == "8K":
        sorts.append("res:4320")
    elif label == "4K / 2160p":
        sorts.append("res:2160")
    elif label == "1440p":
        sorts.append("res:1440")
    elif label == "1080p":
        sorts.append("res:1080")
    elif label in ("720p", "Social / Fast"):
        sorts.append("res:720")
    elif label == "480p":
        sorts.append("res:480")
    elif label == "360p":
        sorts.append("res:360")
    sorts.extend(["fps", "hdr", "vcodec:vp9.2", "vcodec:av1", "vcodec:vp9", "acodec", "channels"])
    return sorts


def format_for_video(label: str) -> str:
    if label == "4K HDR":
        return "bestvideo*[dynamic_range!=SDR]+bestaudio*/bestvideo*+bestaudio/best"
    return "bestvideo*+bestaudio/best"


def apply_video_output(opts: dict[str, Any], quality: str, container: str, platform_id: str) -> None:
    youtube = is_youtube(platform_id)
    merger_basic = {
        "FFmpegMerger": ["-y"],
        "FFmpegVideoRemuxer": ["-y"],
        "FFmpegEmbedSubtitle": ["-y"],
    }
    merger_mp4 = {
        "FFmpegMerger": ["-y", "-movflags", "+faststart"],
        "FFmpegVideoRemuxer": ["-y", "-movflags", "+faststart"],
        "FFmpegEmbedSubtitle": ["-y"],
    }
    choice = (container or "Auto").strip()
    if choice == "Auto":
        # YouTube DASH is usually VP9/AV1 + Opus. Forcing MP4 leaves a .webm.part.
        if youtube:
            opts["merge_output_format"] = "mkv"
            opts["postprocessor_args"] = dict(merger_basic)
        elif platform_id == "vimeo.com":
            opts["merge_output_format"] = "webm"
            opts["postprocessor_args"] = dict(merger_basic)
        else:
            opts["merge_output_format"] = "mp4"
            opts["postprocessor_args"] = dict(merger_mp4)
    elif choice == "MP4":
        opts["merge_output_format"] = "mp4"
        opts["postprocessor_args"] = dict(merger_mp4)
    elif choice == "MKV":
        opts["merge_output_format"] = "mkv"
        opts["postprocessor_args"] = dict(merger_basic)
    elif choice == "WebM":
        opts["merge_output_format"] = "webm"
        opts["postprocessor_args"] = dict(merger_basic)
    else:
        opts["merge_output_format"] = "mp4"
        opts["postprocessor_args"] = dict(merger_mp4)
    opts["recode_video"] = None


def configure_audio(opts: dict[str, Any], audio_quality: str, platform_id: str, is_soundcloud: bool) -> None:
    original = audio_quality == "Best (original)"
    youtube = is_youtube(platform_id)
    if original:
        if is_soundcloud:
            opts["format"] = "bestaudio*/ba/b"
        elif platform_id == "bandcamp.com":
            opts["format"] = "bestaudio*/best"
        elif youtube:
            opts["format"] = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[acodec!=none]/bestaudio*"
        else:
            opts["format"] = "bestaudio*/bestaudio/best"
        opts["writethumbnail"] = True
        opts["embedthumbnail"] = True
        post: list[dict[str, Any]] = [
            {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"},
            {"key": "FFmpegMetadata", "add_metadata": True, "add_chapters": True},
            {"key": "EmbedThumbnail"},
        ]
        if platform_id == "bandcamp.com":
            post.insert(1, {"key": "FFmpegExtractAudio", "preferredcodec": "flac", "preferredquality": "0"})
        elif youtube:
            post.insert(1, {"key": "FFmpegExtractAudio", "preferredcodec": "best", "preferredquality": "0"})
        opts["postprocessors"] = post
    else:
        quality_map = {
            "320kbps": "bestaudio[abr<=320]/bestaudio[abr>=256]/bestaudio",
            "256kbps": "bestaudio[abr<=256]/bestaudio[abr>=192]/bestaudio",
            "192kbps": "bestaudio[abr<=192]/bestaudio[abr>=128]/bestaudio",
            "128kbps": "bestaudio[abr<=128]/bestaudio[abr>=96]/bestaudio",
            "96kbps": "bestaudio[abr<=96]/bestaudio[abr>=64]/bestaudio",
            "64kbps": "bestaudio[abr<=64]/bestaudio",
        }
        opts["format"] = quality_map.get(audio_quality, "bestaudio/bestaudio*")
        kbps = audio_quality.replace("kbps", "") if "kbps" in audio_quality else "192"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": kbps}
        ]
    opts["postprocessor_args"] = {
        "FFmpegMetadata": ["-y"],
        "EmbedThumbnail": ["-y"],
        "FFmpegExtractAudio": ["-y"],
        "FFmpegThumbnailsConvertor": ["-y"],
    }
    opts["keepvideo"] = False
    opts["prefer_ffmpeg"] = True
    if is_soundcloud:
        opts["hls_prefer_native"] = False
        opts["external_downloader"] = {"default": "ffmpeg"}
        opts["external_downloader_args"] = {
            "ffmpeg": ["-y", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
        }
        opts["sleep_interval"] = 2
        opts["max_sleep_interval"] = 10
        opts["retries"] = 15
        opts["fragment_retries"] = 10


def apply_youtube_clients(opts: dict[str, Any], *, music: bool = False, fallback: bool = False) -> None:
    extractor_args = dict(opts.get("extractor_args") or {})
    youtube = dict(extractor_args.get("youtube") or {})
    if os.environ.get("YTDLP_POT_BASE_URL"):
        # Explicit helper deployments use the PO-enabled client recommended by
        # yt-dlp. Mixing legacy clients can select streams that still return 403.
        youtube["player_client"] = ["web_safari"] if fallback else ["mweb"]
    elif music:
        youtube["player_client"] = ["tv", "web_music", "web_safari", "android_vr"]
    elif fallback:
        youtube["player_client"] = ["tv", "android_vr", "web_safari", "ios"]
    youtube["comment_sort"] = ["top"]
    youtube["max_comments"] = [0]
    extractor_args["youtube"] = youtube
    opts["extractor_args"] = extractor_args


def apply_youtube_fallback(opts: dict[str, Any]) -> None:
    apply_youtube_clients(opts, fallback=True)


def is_complete_media(path: str) -> bool:
    if not path or not os.path.isfile(path):
        return False
    lower = path.lower()
    if lower.endswith(JUNK_SUFFIXES):
        return False
    ext = os.path.splitext(path)[1].lower()
    if ext in IMAGE_FILE_EXT:
        return False
    return ext in MEDIA_FILE_EXT


def filepath_from_info(info: dict[str, Any]) -> str:
    if not info:
        return ""
    if info.get("_type") in ("playlist", "multi_video"):
        for entry in reversed([e for e in (info.get("entries") or []) if isinstance(e, dict)]):
            found = filepath_from_info(entry)
            if found:
                return found
        return ""
    for key in ("filepath", "filename"):
        value = info.get(key)
        if isinstance(value, str) and is_complete_media(value):
            return os.path.abspath(value)
    for item in info.get("requested_downloads") or []:
        if not isinstance(item, dict):
            continue
        for key in ("filepath", "filename"):
            value = item.get(key)
            if isinstance(value, str) and is_complete_media(value):
                return os.path.abspath(value)
    return ""


def resolve_downloaded_file(last_path: str, target_dir: str, video_id: str = "") -> str:
    if is_complete_media(last_path):
        return os.path.abspath(last_path)
    parents: list[str] = []
    if last_path:
        parent = os.path.dirname(last_path)
        if parent and os.path.isdir(parent):
            parents.append(parent)
    elif target_dir and os.path.isdir(target_dir):
        parents.append(target_dir)
    stem = os.path.splitext(os.path.basename(last_path or ""))[0]
    for parent in parents:
        try:
            names = os.listdir(parent)
        except OSError:
            continue
        scored: list[tuple[int, str]] = []
        for name in names:
            path = os.path.join(parent, name)
            if not is_complete_media(path):
                continue
            score = 0
            if video_id and video_id in name:
                score += 4
            if stem and os.path.splitext(name)[0] == stem:
                score += 3
            if stem and name.startswith(stem):
                score += 1
            scored.append((score, path))
        if scored:
            scored.sort(key=lambda row: (row[0], os.path.getmtime(row[1])), reverse=True)
            return scored[0][1]
    return last_path or ""


def _summarize_formats(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for fmt in formats or []:
        height = fmt.get("height") or 0
        width = fmt.get("width") or 0
        acodec = fmt.get("acodec") or "none"
        vcodec = fmt.get("vcodec") or "none"
        if vcodec == "none" and acodec == "none":
            continue
        note = str(fmt.get("format_note") or "")
        protocol = str(fmt.get("protocol") or "")
        if "storyboard" in note.lower() or protocol == "mhtml":
            continue
        size = fmt.get("filesize") or fmt.get("filesize_approx") or 0
        rows.append(
            {
                "id": fmt.get("format_id"),
                "ext": fmt.get("ext"),
                "note": fmt.get("format_note") or "",
                "width": width,
                "height": height,
                "fps": fmt.get("fps") or 0,
                "vcodec": None if vcodec == "none" else vcodec,
                "acodec": None if acodec == "none" else acodec,
                "abr": fmt.get("abr") or 0,
                "tbr": fmt.get("tbr") or 0,
                "size": size,
                "dynamic_range": fmt.get("dynamic_range") or "SDR",
                "protocol": fmt.get("protocol") or "",
            }
        )
    rows.sort(key=lambda r: (r["height"] or 0, r["tbr"] or 0), reverse=True)
    return rows[:80]


def _entry_thumb(info: dict[str, Any]) -> str:
    thumb = info.get("thumbnail") or ""
    if thumb:
        return thumb
    thumbs = info.get("thumbnails") or []
    if thumbs:
        best = max(thumbs, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))
        return best.get("url") or ""
    return ""


def _public_info(info: dict[str, Any], url: str, allow_playlist: bool) -> dict[str, Any]:
    platform = detect_platform(url)
    info_type = info.get("_type") or "video"
    is_playlist = info_type in ("playlist", "multi_video")
    entries_raw = info.get("entries") or []
    entries = []
    if is_playlist:
        for i, entry in enumerate(entries_raw):
            if not isinstance(entry, dict):
                continue
            entry_url = entry.get("url") or entry.get("webpage_url") or ""
            if entry_url and not entry_url.startswith("http"):
                vid = entry.get("id") or entry_url
                if "youtube" in platform["id"]:
                    entry_url = f"https://www.youtube.com/watch?v={vid}"
            entries.append(
                {
                    "index": i + 1,
                    "id": entry.get("id"),
                    "title": entry.get("title") or f"Item {i + 1}",
                    "duration": entry.get("duration") or 0,
                    "uploader": entry.get("uploader") or entry.get("channel") or "",
                    "thumbnail": _entry_thumb(entry),
                    "url": entry_url,
                    "selected": True,
                }
            )
    formats = _summarize_formats(info.get("formats") or [])
    heights = [f["height"] for f in formats if f.get("height")]
    has_hdr = any((f.get("dynamic_range") or "SDR") != "SDR" for f in formats)
    return {
        "url": url,
        "id": info.get("id"),
        "title": info.get("title") or info.get("playlist_title") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel") or info.get("artist") or "",
        "duration": info.get("duration") or 0,
        "thumbnail": _entry_thumb(info),
        "webpage_url": info.get("webpage_url") or url,
        "platform": platform,
        "is_playlist": bool(allow_playlist and is_playlist and entries),
        "playlist_count": len(entries),
        "entries": entries,
        "formats": formats,
        "max_height": max(heights) if heights else 0,
        "has_hdr": has_hdr,
        "description": (info.get("description") or "")[:400],
        "upload_date": info.get("upload_date") or "",
        "view_count": info.get("view_count") or 0,
        "chapters": [
            {"title": c.get("title") or "", "start": c.get("start_time") or 0}
            for c in (info.get("chapters") or [])
            if isinstance(c, dict)
        ],
        "suggested_mode": platform.get("kind") or "video",
        "extractor": info.get("extractor_key") or info.get("extractor") or "",
    }


def probe(url: str, settings: dict[str, Any], allow_playlist: bool = False) -> dict[str, Any]:
    if is_drm_url(url):
        raise ValueError("This site uses DRM. Full downloads are not supported.")
    platform = detect_platform(url)
    target = canonicalize_youtube_url(url)
    if not allow_playlist:
        target = youtube_strip_playlist(target)
    opts = base_opts(settings)
    opts["skip_download"] = True
    opts["noplaylist"] = not allow_playlist
    if allow_playlist:
        opts["extract_flat"] = "in_playlist"
    if is_youtube(platform["id"]):
        apply_youtube_clients(opts, music=platform["id"] == "music.youtube.com")
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target, download=False)
    if not info:
        raise ValueError("Could not read this URL.")
    return _public_info(info, url, allow_playlist)


def _srt_to_plain(content: str) -> str:
    text = content.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs: list[str] = []
    block: list[str] = []
    for raw in text.split("\n"):
        line = raw.strip("\ufeff ")
        if re.fullmatch(r"\d+", line) or "-->" in line:
            continue
        if line.startswith("WEBVTT") or line.startswith("STYLE") or line.startswith("NOTE"):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        line = html.unescape(line).strip()
        if line:
            block.append(line)
        elif block:
            paragraphs.append(" ".join(block))
            block = []
    if block:
        paragraphs.append(" ".join(block))
    return "\n\n".join(p for p in paragraphs if p)


def convert_captions(base_dir: str) -> None:
    for root, _dirs, files in os.walk(base_dir):
        for name in files:
            if not name.lower().endswith((".srt", ".vtt")):
                continue
            src = os.path.join(root, name)
            dest = os.path.splitext(src)[0] + ".txt"
            try:
                if os.path.exists(dest) and os.path.getmtime(dest) >= os.path.getmtime(src):
                    continue
                with open(src, "r", encoding="utf-8", errors="replace") as handle:
                    plain = _srt_to_plain(handle.read())
                with open(dest, "w", encoding="utf-8") as handle:
                    handle.write(plain.strip() + "\n")
            except Exception:
                pass


def ffprobe_video(path: str) -> Optional[dict[str, Any]]:
    if not path or not os.path.isfile(path):
        return None
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-select_streams",
                "v:0",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return None
        streams = (json.loads(result.stdout).get("streams") or [])
        if not streams:
            return None
        stream = streams[0]
        return {
            "width": stream.get("width"),
            "height": stream.get("height"),
            "codec": stream.get("codec_name"),
            "fps": stream.get("r_frame_rate"),
            "pix_fmt": stream.get("pix_fmt"),
        }
    except Exception:
        return None


def quality_note(path: str, requested: str, mode: str) -> str:
    if mode != "video":
        return ""
    info = ffprobe_video(path)
    if not info:
        return ""
    height = info.get("height") or 0
    width = info.get("width") or 0
    codec = info.get("codec") or "unknown"
    fps = info.get("fps") or "?"
    note = f"{width}x{height} {codec} @ {fps}"
    cap = HEIGHT_CAPS.get(requested)
    if cap and height and height < int(cap * 0.85):
        return f"Downloaded {height}p but preset was {requested}."
    return note


def _playlist_folder(settings: dict[str, Any], mode: str, title: str, uploader: str, url: str) -> str:
    root = settings["music_folder"] if mode == "audio" else settings["video_folder"]
    safe_title = safe_component(title)[:80]
    safe_uploader = safe_component(uploader) if uploader else ""
    lower = url.lower()
    if "music.youtube.com" in lower:
        name = f"{safe_uploader} - {safe_title}" if safe_uploader else f"YouTube Music - {safe_title}"
        return os.path.join(root, "YouTube Music Playlists", name)
    if "soundcloud.com" in lower:
        return os.path.join(root, "Playlists", safe_title)
    if "bandcamp.com" in lower:
        name = f"{safe_uploader} - {safe_title}" if safe_uploader else safe_title
        return os.path.join(root, "Bandcamp Albums", name)
    if any(word in safe_title.lower() for word in ("album", "ep", "mixtape")):
        name = f"{safe_uploader} - {safe_title}" if safe_uploader else safe_title
        return os.path.join(root, "Albums", name)
    return os.path.join(root, "Playlists", safe_title)


def _write_playlist_info(folder: str, title: str, uploader: str, url: str) -> None:
    try:
        audio = [f for f in os.listdir(folder) if f.lower().endswith((".mp3", ".flac", ".m4a", ".opus", ".wav"))]
        path = os.path.join(folder, "playlist_info.txt")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(
                f"Title: {title}\nUploader: {uploader or 'Unknown'}\nSource: {url}\n"
                f"Downloaded: {datetime.now().strftime('%Y-%m-%d %H:%M')}\nTracks: {len(audio)}\n"
            )
    except Exception:
        pass


def download(
    url: str,
    settings: dict[str, Any],
    on_progress: ProgressFn,
    should_stop: StopFn,
    playlist_items: Optional[str] = None,
) -> dict[str, Any]:
    if is_drm_url(url):
        raise ValueError("This site uses DRM. Full downloads are not supported.")

    mode = settings.get("mode") or "video"
    quality = settings.get("quality") or "Best Available"
    audio_quality = settings.get("audio_quality") or "Best (original)"
    container = settings.get("container") or "Auto"
    allow_playlist = bool(settings.get("playlist"))
    source_url = url
    platform = detect_platform(source_url)
    target = canonicalize_youtube_url(source_url)
    if not allow_playlist:
        target = youtube_strip_playlist(target)
    is_soundcloud = "soundcloud" in platform["id"]
    youtube = is_youtube(platform["id"])
    music = platform["id"] == "music.youtube.com"

    opts = base_opts(settings)
    opts["noplaylist"] = not allow_playlist
    opts["ignoreerrors"] = "only_download" if (allow_playlist or playlist_items) else False
    if playlist_items:
        opts["playlist_items"] = playlist_items
        opts["noplaylist"] = False

    if "tiktok.com" in target.lower():
        opts["http_headers"] = {"Referer": "https://www.tiktok.com/", "Origin": "https://www.tiktok.com"}

    if youtube:
        apply_youtube_clients(opts, music=music or mode == "audio")

    if mode == "audio":
        configure_audio(opts, audio_quality, platform["id"], is_soundcloud)
    elif settings.get("device_safe"):
        # Phones and QuickTime want H.264 + AAC in MP4. Pick that at the source so
        # nothing has to be re-encoded afterwards.
        cap = HEIGHT_CAPS.get(quality) or 1080
        # Sites spell the codec either way: YouTube reports avc1.640028, TikTok h264.
        avc = r"[vcodec~='^(avc1|h264)']"
        opts["format"] = (
            f"bestvideo{avc}[height<={cap}]+bestaudio[ext=m4a]/"
            f"bestvideo{avc}[height<={cap}]+bestaudio/"
            f"best[ext=mp4][height<={cap}]/best[height<={cap}]/best"
        )
        # Codec outranks resolution here: a vertical clip is taller than the cap, so the
        # capped rungs miss and the sort is all that keeps this off an HEVC-only stream.
        opts["format_sort"] = ["vcodec:h264", "acodec:aac", f"res:{cap}", "fps"]
        apply_video_output(opts, quality, "MP4", platform["id"])
    else:
        opts["format"] = format_for_video(quality)
        opts["format_sort"] = format_sort_for_video(quality)
        apply_video_output(opts, quality, container, platform["id"])

    if settings.get("subtitles"):
        opts["writesubtitles"] = True
        opts["writeautomaticsub"] = True
        opts["subtitleslangs"] = ["en", "en-US", "en-GB"]
        if mode == "video":
            opts["subtitlesformat"] = "vtt"
            opts["embedsubtitles"] = True
        else:
            opts["subtitlesformat"] = "srt"
    else:
        opts["writesubtitles"] = False
        opts["writeautomaticsub"] = False
        opts["embedsubtitles"] = False

    sb = settings.get("sponsorblock") or "off"
    if sb == "mark":
        opts["sponsorblock_mark"] = ["all"]
    elif sb == "remove":
        opts["sponsorblock_remove"] = ["sponsor", "selfpromo", "interaction"]

    last_path = {"value": ""}

    def hook(status: dict[str, Any]) -> None:
        if should_stop():
            raise KeyboardInterrupt("cancelled")
        state = status.get("status")
        if state == "downloading":
            downloaded = status.get("downloaded_bytes") or 0
            total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
            percent = int(downloaded * 100 / total) if total else 0
            on_progress(
                {
                    "status": "downloading",
                    "percent": min(percent, 99),
                    "speed": status.get("speed") or 0,
                    "eta": status.get("eta") or 0,
                    "filename": status.get("filename") or "",
                    "fragment": status.get("fragment_index"),
                    "fragment_count": status.get("fragment_count"),
                }
            )
        elif state in ("finished", "postprocessing"):
            filename = status.get("filename") or ""
            if filename:
                abs_name = os.path.abspath(filename)
                if is_complete_media(abs_name) or not is_complete_media(last_path["value"]):
                    last_path["value"] = abs_name
            on_progress({"status": state, "percent": 100, "filename": last_path["value"]})

    opts["progress_hooks"] = [hook]

    probe_opts = {k: opts[k] for k in ("quiet", "noplaylist", "js_runtimes", "extractor_args") if k in opts}
    apply_cookies(probe_opts, settings)
    probe_opts["skip_download"] = True
    if playlist_items:
        probe_opts["playlist_items"] = playlist_items
        probe_opts["noplaylist"] = False
    if allow_playlist:
        probe_opts["extract_flat"] = "in_playlist"

    playlist_title = ""
    playlist_uploader = ""
    is_playlist = False
    try:
        with YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(target, download=False) or {}
        info_type = info.get("_type") or ""
        is_playlist = allow_playlist and info_type in ("playlist", "multi_video") and bool(info.get("entries"))
        if is_playlist:
            playlist_title = info.get("title") or info.get("playlist_title") or info.get("album") or ""
            playlist_uploader = info.get("uploader") or info.get("channel") or info.get("artist") or ""
    except Exception:
        info = {}

    root = settings["music_folder"] if mode == "audio" else settings["video_folder"]
    if is_playlist and playlist_title:
        target_dir = _playlist_folder(settings, mode, playlist_title, playlist_uploader, source_url)
        if mode == "audio":
            opts["outtmpl"] = os.path.join(target_dir, "%(title)s - %(artist)s [%(id)s].%(ext)s")
        else:
            opts["outtmpl"] = os.path.join(target_dir, "%(title)s [%(id)s]", "%(title)s [%(id)s].%(ext)s")
    else:
        target_dir = root
        if mode == "audio":
            opts["outtmpl"] = os.path.join(target_dir, "%(title)s [%(id)s].%(ext)s")
        else:
            opts["outtmpl"] = os.path.join(target_dir, "%(title)s [%(id)s]", "%(title)s [%(id)s].%(ext)s")

    os.makedirs(target_dir, exist_ok=True)
    for pattern in ("*.part", "*.temp", "*.ytdl", "*.tmp"):
        for path in glob.glob(os.path.join(target_dir, pattern)):
            try:
                os.remove(path)
            except Exception:
                pass

    youtube_fallback = False
    if mode == "video" and youtube:
        cap = HEIGHT_CAPS.get(quality)
        if cap and cap > 720:
            try:
                heights = [f.get("height") or 0 for f in (info.get("formats") or [])]
                max_h = max(heights) if heights else 0
                if max_h and max_h <= 720:
                    apply_youtube_clients(opts, fallback=True, music=music)
                    youtube_fallback = True
            except Exception:
                pass

    downloaded_info: dict[str, Any] = {}
    note_extra = ""

    def run() -> dict[str, Any]:
        enable_artwork_options(opts)
        with YoutubeDL(opts) as ydl:
            attach_artwork(ydl, target_dir)
            return ydl.extract_info(target, download=True) or {}

    try:
        downloaded_info = run()
    except KeyboardInterrupt:
        raise
    except Exception as first:
        if youtube and not youtube_fallback:
            apply_youtube_clients(opts, fallback=True, music=music)
            youtube_fallback = True
            if mode == "video":
                opts["merge_output_format"] = "mkv"
            try:
                downloaded_info = run()
            except KeyboardInterrupt:
                raise
            except Exception:
                if mode == "video" and music:
                    configure_audio(opts, audio_quality, platform["id"], False)
                    apply_youtube_clients(opts, music=True)
                    downloaded_info = run()
                    note_extra = "This YouTube Music track has no video — saved audio instead."
                    mode = "audio"
                else:
                    raise first
        elif mode == "video" and music:
            configure_audio(opts, audio_quality, platform["id"], False)
            apply_youtube_clients(opts, music=True)
            downloaded_info = run()
            note_extra = "This YouTube Music track has no video — saved audio instead."
            mode = "audio"
        else:
            raise first

    if is_playlist and playlist_title and mode == "audio":
        _write_playlist_info(target_dir, playlist_title, playlist_uploader, source_url)
    if settings.get("subtitles"):
        convert_captions(target_dir)

    video_id = str((downloaded_info or info or {}).get("id") or "")
    path = filepath_from_info(downloaded_info) or resolve_downloaded_file(
        last_path["value"], target_dir, video_id
    )
    if not is_complete_media(path):
        raise RuntimeError(
            "Download finished without a media file (thumbnail or leftover .part). "
            "For YouTube Music, stay on Audio, update yt-dlp, or attach cookies from a logged-in browser."
        )

    note = quality_note(path, quality, mode)
    if note_extra:
        note = f"{note_extra} {note}".strip()
    return {
        "path": path,
        "folder": target_dir,
        "quality_note": note,
        "title": playlist_title
        or (downloaded_info.get("title") if isinstance(downloaded_info, dict) else "")
        or (info.get("title") if isinstance(info, dict) else "")
        or "",
    }


def browse_folder(prompt: str = "Choose folder") -> str:
    if sys.platform == "darwin":
        script = f'POSIX path of (choose folder with prompt "{prompt}")'
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
        return ""
    if os.name == "nt":
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
            "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"
        )
        result = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
        return (result.stdout or "").strip()
    for cmd in (
        ["zenity", "--file-selection", "--directory", f"--title={prompt}"],
        ["kdialog", "--getexistingdirectory", os.path.expanduser("~")],
    ):
        if shutil.which(cmd[0]):
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return result.stdout.strip()
    return ""


def browse_file(prompt: str = "Choose cookies.txt") -> str:
    if sys.platform == "darwin":
        script = f'POSIX path of (choose file with prompt "{prompt}")'
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
        return ""
    if os.name == "nt":
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$d = New-Object System.Windows.Forms.OpenFileDialog; "
            "$d.Filter = 'Text|*.txt|All|*.*'; "
            "if ($d.ShowDialog() -eq 'OK') { $d.FileName }"
        )
        result = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
        return (result.stdout or "").strip()
    return ""


def open_path(path: str, reveal: bool = False) -> None:
    if not path:
        return
    if path.startswith("http://") or path.startswith("https://"):
        if sys.platform.startswith("darwin"):
            subprocess.call(["open", path])
        elif os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            subprocess.call(["xdg-open", path])
        return
    if sys.platform == "darwin":
        subprocess.call(["open", "-R", path] if reveal and os.path.isfile(path) else ["open", path])
    elif os.name == "nt":
        if reveal and os.path.isfile(path):
            subprocess.call(["explorer", "/select,", path])
        else:
            os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.call(["xdg-open", path if os.path.isdir(path) else os.path.dirname(path)])


def update_ytdlp() -> str:
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "yt-dlp[default]",
        "bgutil-ytdlp-pot-provider",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or "Update failed")
    import importlib
    import yt_dlp

    importlib.reload(yt_dlp)
    return yt_dlp.version.__version__
