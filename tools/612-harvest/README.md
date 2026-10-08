# 612 Harvest

Local stock reel studio for documentary / YouTube B-roll. **Scout previews, keep the shots, pull only those.**

This is the 612 rebuild of Clip Harvester (`Auto_Harvester`). The original app is unchanged.

## Why it is different

Clip Harvester parses an outline and **downloads N results per query** from Pexels / Pixabay / Unsplash into folders. That fills disks with clips you will never cut, and it does nothing until you paste API keys.

612 Harvest is a select bin:

1. Paste a timestamped visual outline (or a raw script).
2. **Scout** — search Wikimedia Commons, Openverse, NASA, plus optional Pexels / Pixabay / Unsplash. Thumbnails only.
3. **Keep** — star the clips you would actually edit with. Hover videos to preview.
4. **Pull** — download keepers into per-section bins, write `credits.txt` for the YouTube description, and write `resolve.fcpxml` for DaVinci Resolve.

Zero-key providers work on a fresh Mac. Pexels / Unsplash keys are optional extras.

## Quick start

```bash
cd tools/612-harvest
./run.sh
```

Opens [http://127.0.0.1:5179](http://127.0.0.1:5179). API is `127.0.0.1:8791`.

Outline format is the same as Clip Harvester:

```
0:00-0:30 Hook
Visuals
- News studio footage
- Breaking news lower thirds
On-screen text
RARE VIRUS
AI clips you can generate
- Microscopic virus animation
```

## Output

```
projects/<slug>/
  project.json
  scout.json
  manifest.csv
  credits.txt
  resolve.fcpxml
  shotlist_ai.md
  text_overlays.md
  bins/01_hook/videos/...
```

Keys live in gitignored `config.json` (copy from `config.example.json`). Env vars `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY` still work.
