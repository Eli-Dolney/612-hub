# 612 Play

A free, fully local music player that runs in the browser. Nothing is uploaded. No accounts, no cloud library, no Electron install.

Built as a comparison to Music UI : same job (play the files already on disk), different architecture.

## Why this vs Music UI

| | Music UI | 612 Play |
|---|---|---|
| Runtime | Electron + Vite | Vite, Chromium browser |
| Library | Watch folders over IPC | File System Access API + drag-and-drop |
| Persistence | JSON in Electron userData | IndexedDB (tracks, art, peaks, playlists) |
| UI | YouTube Music clone | Listening room — stage, waveform, queue |
| Playback | Single `<audio>` element | Dual-element **crossfade**, EQ, glue compressor |
| Visualizer | Overlay tab among 16 modes | Always on the stage, 6 modes |
| Seek | Thin progress line | Cached waveform |
| Smart lists | Rules with placeholder dates | Real play counts, last played, added time |
| Lyrics | Manual paste | Reads sibling `.lrc` files while scanning |
| Media keys | No | Media Session API |
| Cost | Free | Free |

## Run

Needs Node.js 18+ and a Chromium browser (Chrome, Edge, Arc) so folder access can persist after refresh.

```bash
npm install
npm run dev
```

Open http://localhost:5176. For a static build:

```bash
npm run build
npm run preview
```

## Listening workflow

1. **Open music folder** (or drop one on the window). 612 Play walks the tree, reads tags/art, and stores the catalog locally.
2. Play from **Listen**, **Tracks**, an album, or a mix.
3. The stage is the product: album art, visualizer, optional synced lyrics.
4. **Sound** (sliders icon) for EQ presets, glue compressor, and crossfade length.
5. After a refresh, click **Allow** on a folder if the browser asks — the catalog is already there.

## Mixes

Generated from actual listening, not placeholders:

- Liked
- On repeat
- Forgotten gems (played before, quiet for 30+ days)
- Just in
- Never played
- Under 3 minutes
- Biggest genre in the library

## Shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Seek 5s |
| Shift + arrows | Seek 15s |
| ↑ / ↓ | Volume |
| [ / ] or P / N | Previous / next |
| S / R / L / M / Q | Shuffle, repeat, like, mute, queue |
| ⌘/Ctrl K | Search |
| ? | Shortcut list |

## Stack

React 19, TypeScript, Vite, Web Audio, File System Access API, IndexedDB, Lucide, Fontsource (Fraunces / Figtree). MIT-licensed fonts only. No analytics.

## Downloaded artwork

612 Pull and LTW_Downloader can save a 128×128 `<song>.cover.png` next to each audio file,
plus portable `.artwork.json` manifests for songs and playlists. Open or rescan the
download folder to show these covers, including for WAV files. The player prefers the
matching sidecar, then embedded artwork, then a folder cover; missing art keeps the
record icon. Personal playlists display their first available track cover. Playlist
manifest files are for external consumers such as Minecraft; they are not auto-imported
as player playlists.

The browser database and preference keys retain their historical names for compatibility
so the 612 branding does not reset existing libraries, playlists, or settings.
