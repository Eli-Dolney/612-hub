# 612 Clip

Transcript-first shorts cutter. **Probe the file, keep the lines, export a bundle.** Whisper, FFmpeg, and your footage stay on this machine.

Part of the [612 Hub](../612-hub) studio. Clip is a select bin — not another NLE, and not a second Pull / Harvest / Edit.

## Why it is different

| | LTW Splitter | 612 Clip |
|---|---|---|
| UI | CustomTkinter desktop | Vite + React studio |
| Before Whisper | Pick a file, wait | Probe first: waveform + poster |
| Progress | Blocking GUI | SSE job queue |
| Edit | Full Edit Suite NLE | In/Out clip bin + keep/drop lines |
| Suggest | — | Local hooks + silence islands |
| 9:16 | MediaPipe (required) | OpenCV Haar, no MediaPipe |
| Layout | Tabs for everything | Library · stage · inspector |
| Thumbnails | Local still | PNG → 612 Edit on :5174 |

## Quick start

Needs **Python 3.12+**, **Node.js 18+**, and **FFmpeg**.

```bash
cd tools/612-clip
chmod +x run.sh
./run.sh
```

Opens [http://127.0.0.1:5180](http://127.0.0.1:5180). API is `127.0.0.1:8792`.

First **Transcribe** downloads a Whisper `base` model into `~/.cache/grokclip/whisper/` — that takes a few minutes. Later runs reuse it. `tiny` is faster; `small` is cleaner.

Apple Silicon uses CPU int8 for Whisper (faster-whisper has no MPS path). Video encode uses VideoToolbox when FFmpeg has it.

## Workflow

1. Open a talking-head, interview, music video, or screen recording (or pick a **612 Pull** download).
2. Watch the waveform. Hit **In** then **Out** (`I` / `O`) and **Enter** to add a clip, or drag a range. **Space** plays/pauses.
3. Or **Transcribe**, then **Suggest hooks** / **Strip silence** — suggestions land in the clip bin for you to keep or drop.
4. **Save** on a row writes that clip. **Save kept clips** writes each keeper. **Concat bundle** joins keepers (or transcript ranges) into `primary.mp4`.
5. Blur-fill (or face crop) fits the source to TikTok / Shorts `9:16`, Reels `4:5`, or other frames. Burn karaoke captions, or **Write SRT / ASS only**.

```
projects/<slug>/
  source.*
  poster.jpg
  logo.png            # optional brand mark
  project.json
  bundle/
    primary.mp4
    clips/
    portrait.mp4
    landscape.mp4
    captions.srt
    captions.ass
    youtube.txt
    thumbnail.png

inbox/                # optional watch folder
```

## Batch / watch inbox

**Batch → Watch inbox** watches `tools/612-clip/inbox` (or a custom path). Drop `mp4/mov/mkv/webm` files; each one becomes a project and runs the selected recipe:

- **Suggest** — probe → Whisper → hook windows in the clip bin
- **Shorts** — probe → Whisper → export with captions
- **Silent** — probe → first 30s, no speech

Multi-file drops in the UI also follow the active inbox recipe. Day-to-day chopping still lives in **Clips**.

URL recipes (thin yt-dlp) stay for one-off downloads — playlists and 4K belong in **612 Pull**.

## Pipeline / orders

Stack steps, then **Queue order**. The worker runs one order at a time.

Examples:

- **Shorts 30s** → keep 30 seconds → transcribe → burn karaoke captions
- **Suggest hooks** → Whisper → score hook windows into the bin
- URL → download 30s with no speech (music / b-roll)

## Ports

| App | Folder | UI | API |
|---|---|---|---|
| 612 Edit | `612-edit` | 5174 | — |
| 612 Pull | `612-pull` | 5175 | 8788 |
| 612 Play | `612-play` | 5176 | — |
| 612 Mix | `612-mix` | 5177 | 8789 |
| 612 Voice | `612-voice` | 5178 | 8790 |
| 612 Harvest | `612-harvest` | 5179 | 8791 |
| 612 Clip | `612-clip` | 5180 | 8792 |
| 612 Hub | `612-hub` | 5181 | 8793 |

## Privacy

All processing is local. Nothing is uploaded. Projects and inbox media are gitignored.

## Stack

React 19, TypeScript, Vite, FastAPI, faster-whisper, OpenCV, FFmpeg, Lucide. Local only.
