"""Portable 128px artwork sidecars. Uses yt-dlp's downloaded images, never extra requests."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zlib
from yt_dlp.postprocessor import PostProcessor

SIZE = 128

def _fallback(path):
    # Dependency-free neutral record icon; a real PNG even without FFmpeg/artwork.
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            r = (x - 64)**2 + (y - 64)**2
            row.extend((205, 157, 84) if 70 < r < 300 else (52, 59, 71) if r < 2700 else (24, 28, 35))
        rows.append(b'\0' + row)
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', SIZE, SIZE, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b''))

def _render(sources, output):
    output = Path(output)
    fd, name = tempfile.mkstemp(suffix='.png', dir=output.parent)
    os.close(fd)
    temp = Path(name)
    try:
        ffmpeg = shutil.which('ffmpeg')
        for source in sources:
            if not ffmpeg or not Path(source).is_file():
                continue
            try:
                result = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(source),
                    '-map', '0:v:0', '-frames:v', '1', '-vf',
                    'scale=128:128:force_original_aspect_ratio=decrease,pad=128:128:(ow-iw)/2:(oh-ih)/2:color=0x181c23',
                    '-update', '1', str(temp)], capture_output=True, timeout=20)
                if result.returncode == 0 and temp.stat().st_size:
                    temp.replace(output)
                    return str(source)
            except (OSError, subprocess.TimeoutExpired):
                pass
        _fallback(temp)
        temp.replace(output)
        return None
    finally:
        temp.unlink(missing_ok=True)

def _json(path, data):
    fd, name = tempfile.mkstemp(suffix='.json', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)

def _images(info):
    return [Path(t['filepath']) for t in reversed(info.get('thumbnails') or []) if t.get('filepath')]

def _id(info, fallback):
    return f"{info.get('extractor_key') or info.get('extractor') or 'local'}:{info.get('id') or hashlib.sha256(fallback.encode()).hexdigest()[:16]}"

class ArtworkPP(PostProcessor):
    def __init__(self, downloader, root):
        super().__init__(downloader)
        self.root = Path(root).resolve()
        self.records = []

    def run(self, info):
        try:
            if info.get('_type') in ('playlist', 'multi_video'):
                self.playlist(info)
            elif info.get('filepath'):
                self.track(info)
        except Exception as exc:
            self.report_warning(f'Artwork sidecar skipped ({type(exc).__name__}); downloaded media is intact.')
        return [], info

    def track(self, info):
        media = Path(info['filepath']).resolve()
        if not media.is_file():
            return
        cover = media.with_suffix('.cover.png')
        source = _render([*_images(info), media], cover)
        original = None
        if source and Path(source) != media:
            # Keep a stable original even if yt-dlp later changes its thumbnail paths.
            ext = Path(source).suffix.lower()
            if ext in ('.jpg', '.jpeg', '.png', '.webp', '.avif'):
                original = media.with_suffix('.artwork' + ext)
                if Path(source).resolve() != original.resolve():
                    shutil.copyfile(source, original)
        record = {'schema_version': 1, 'kind': 'track', 'id': _id(info, media.name),
                  'title': info.get('track') or info.get('title') or media.stem,
                  'artist': info.get('artist') or info.get('uploader') or '',
                  'media': media.name, 'cover': cover.name, 'cover_size': [SIZE, SIZE],
                  'artwork_status': 'available' if source else 'placeholder',
                  'original_artwork': original.name if original else None}
        _json(media.with_suffix('.artwork.json'), record)
        self.records = [(p, r) for p, r in self.records if p != media]
        self.records.append((media, record))

    def playlist(self, info):
        # Restrict membership to this playlist, including selected/partial downloads.
        ids = {str(e.get('id')) for e in (info.get('entries') or []) if isinstance(e, dict)}
        records = [(p, r) for p, r in self.records if r['id'].rsplit(':', 1)[-1] in ids]
        root = records[0][0].parent if records else self.root
        root.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(_id(info, str(info.get('title', 'playlist'))).encode()).hexdigest()[:12]
        base = root / ('playlist-' + key)
        cover = base.with_suffix('.cover.png')
        sources = _images(info)
        sources += [p.with_suffix('.cover.png') for p, r in records if r['artwork_status'] == 'available']
        source = _render(sources, cover)
        tracks = [{'id': r['id'], 'media': os.path.relpath(p, root),
                   'metadata': os.path.relpath(p.with_suffix('.artwork.json'), root),
                   'cover': os.path.relpath(p.with_suffix('.cover.png'), root)} for p, r in records]
        _json(base.with_suffix('.artwork.json'), {'schema_version': 1, 'kind': 'playlist',
            'id': _id(info, str(info.get('title', 'playlist'))), 'title': info.get('title') or 'Playlist',
            'cover': cover.name, 'cover_size': [SIZE, SIZE],
            'artwork_status': 'available' if source else 'placeholder',
            'cover_source': 'playlist' if source and Path(source) in _images(info) else 'track' if source else 'placeholder',
            'tracks': tracks})

def enable_artwork_options(opts):
    opts['writethumbnail'] = True
    # Existing embed processors must leave the image available for our after_move step.
    for pp in opts.get('postprocessors', []):
        if pp.get('key') == 'EmbedThumbnail':
            pp['already_have_thumbnail'] = True

def attach_artwork(ydl, root):
    pp = ArtworkPP(ydl, root)
    ydl.add_post_processor(pp, when='after_move')
    ydl.add_post_processor(pp, when='playlist')
