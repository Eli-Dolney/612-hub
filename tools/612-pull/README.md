# 612 Pull

Local media downloader with a React studio and FastAPI/yt-dlp/FFmpeg backend.

## Run

Follow the repository [setup](../../README.md) or [Windows guide](../../WINDOWS.md).
Prepare this tool's Node dependencies and Python environment, then use
`python3 scripts/run.py pull` from the repository root (Windows: `py -3.12`).
Studio: http://127.0.0.1:5175. API: http://127.0.0.1:8788.

Paste a URL, probe formats, choose video/audio output and queue a download.
Use Play for music, Clip for editing footage, and [612 Edit](../612-edit) for a frame/thumbnail.
Downloads and music stay local and are ignored by Git.

YouTube may need the optional bgutil PO-token helper. The POSIX helper setup is
`bash tools/ensure-pot.sh` inside this folder; it downloads third-party code only
when explicitly run. See the Docker option below for a separate helper service.
No helper or model is bundled in the repository.

## Optional guest API / Docker

The studio runs locally without a sharing password. Guest login is disabled until
`GROKPULL_PASSWORD` is configured; there is no default password. Configure extra
allowed frontend origins with `GROKPULL_CORS`. A hosted guest frontend is not included.
Legacy environment variable names remain compatible.

Create a private `.env` inside this tool containing your own `GROKPULL_PASSWORD`.
The file is ignored and must never be committed. With Docker available:

```sh
docker compose up -d --build
curl http://127.0.0.1:8788/api/guest/status
docker compose down
```

The optional `share` Compose profile creates a public tunnel only when explicitly
requested. Its URL is an API address, not a standalone guest UI. Configure your
own frontend against that address and add its origin to `GROKPULL_CORS`.
Mac `.command` launchers are optional Docker helpers; use PowerShell/Docker CLI on Windows.
The Compose project identity and `.grokpull*` settings paths retain their historical
names for compatibility. No personal site deployment configuration is included.

## Portable cover images

New downloads also save `<song>.cover.png` (128×128, aspect-preserving with padding),
`<song>.artwork.json`, and a retained `<song>.artwork.<ext>` source image when available.
The manifest links the exact media and cover filenames using relative paths and a stable
extractor/media ID. It deliberately excludes account data, request headers and source URLs.

Playlists save `playlist-<stable-id>.cover.png` and `.artwork.json`, with links to each
successfully downloaded track. A playlist uses its own thumbnail when provided, then a
track cover, then a neutral placeholder. Track artwork likewise falls back to embedded
artwork or a placeholder. A missing image never fails a successful media download.

Minecraft can load the 128×128 PNG directly; copy its manifest and linked files together.
Images are generated locally with the existing FFmpeg installation; no paid service or
additional image dependency is needed. Existing downloads are not changed automatically.
