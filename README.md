# GrokClip

Transcript-first shorts cutter. **Probe the file, keep the lines, export a bundle.** Whisper, FFmpeg, and your footage stay on this machine.

This is the Grok-vs rebuild of [LTW Video Splitter](../Python%20Scripts/LTW_Splitter). The original app is unchanged. GrokClip is not another NLE.

## Why it is different

Splitter is a CustomTkinter kitchen sink: Whisper, Edit Suite timeline, masks, chroma, beat sync, templates. Useful, and heavy.

GrokClip is a select bin:

1. Drop a long file (or pick a [GrokPull](../grok-pull) download).
2. **Probe** — poster, duration, waveform. Whisper has not started.
3. **Cut** — mark In/Out at the playhead (or drag the waveform) and **Add clip**. Repeat for as many ranges as you want. **Save** writes one file; **Export kept clips** concatenates every kept range and also writes `bundle/clips/`.
4. **Transcribe** — faster-whisper as an SSE job. Keep/drop lines, or skip this if you only marked clips (you still need it for captions).
5. **Export** — 9:16 blur-fill with customizable karaoke captions (position, colors, size, words/line), plus 16:9, `.srt` / `.ass`, `youtube.txt`, thumbnail PNG into [GrokEdit](../grok).

The preview on the stage is the same layout the encoder writes: blurred cover behind a sharp contained plate, karaoke captions in the lower blur band, optional glow/solid border, credit in a lower corner, logo in the other.

Marked clips win over transcript keep/drop on export. Whisper is still useful for search and skip-unkept when you have not set ranges.

## Pipeline / orders

Stack steps, then **Queue order**. The worker runs one order at a time; you can pile more while it works.

Examples:

- **Shorts 30s** → keep 30 seconds → transcribe that window → burn karaoke captions in the blur
- This clip → Whisper the whole file → export with captions
- URL → download 30s with no speech (music / b-roll)

Trim is a window on the source (not a rewrite), so Whisper only hears the kept range. URL orders use yt-dlp and create a new project. Brand settings (frame, blur, credit, logo, border) snapshot onto the order when you queue it.

Skip unkept ranges while you play. Clips you mark (or kept transcript lines) are the cut.

| | LTW Splitter | GrokClip |
|---|---|---|
| UI | CustomTkinter desktop | Vite + React studio |
| Before Whisper | Pick a file, wait | Probe first: waveform + poster |
| Progress | Blocking GUI | SSE job queue |
| Edit | Full Edit Suite NLE | In/Out clip bin + keep/drop lines |
| 9:16 | MediaPipe (required) | OpenCV Haar, no MediaPipe |
| Layout | Tabs for everything | Library · stage · inspector |
| Thumbnails | Local still | PNG → GrokEdit on :5174 |

## Quick start

Needs **Python 3.12+**, **Node.js 18+**, and **FFmpeg**.

```bash
cd ~/Desktop/grok-clip
chmod +x run.sh
./run.sh
```

Opens [http://127.0.0.1:5180](http://127.0.0.1:5180). API is `127.0.0.1:8792`.

First **Transcribe** downloads a Whisper `base` model into `~/.cache/grokclip/whisper/` — that takes a few minutes. Later runs reuse it. `tiny` is faster; `small` is cleaner.

Apple Silicon uses CPU int8 for Whisper (faster-whisper has no MPS path). Video encode uses VideoToolbox when FFmpeg has it.

## Workflow

1. Open a talking-head, interview, music video, or screen recording.
2. Watch the waveform. Hit **In** then **Out** (keys `I` / `O`) and **Add clip**, or drag a range on the waveform. Walk the whole file and stack as many clips as you want.
3. **Save** on a row writes that clip now. **Export kept clips** concatenates every kept range into `primary.mp4` and also writes each file under `bundle/clips/`. Drop a row from the group with **Keep** / **Drop**.
4. Or **Transcribe**, unkeep tangents, then export from the transcript instead.
5. Blur-fill (or face crop) fits the source to 9:16 / 16:9 / 1:1 / 4:5. Add a lower-corner credit, a PNG logo, and a glow border before you hit export.

```
projects/<slug>/
  source.*
  poster.jpg
  logo.png            # optional brand mark
  project.json
  bundle/
    primary.mp4       # concat of kept clips (or transcript ranges)
    clips/            # each kept clip as its own file
    portrait.mp4      # 1080×1920
    landscape.mp4     # 1920×1080
    captions.srt
    youtube.txt
    thumbnail.png
```

**Thumbnail → GrokEdit** opens the PNG in GrokEdit if that app is running on port 5174. GrokPull (`:8788`) can also serve the file; GrokClip serves it on `:8792` as a fallback.

## Ports

| App | UI | API |
|---|---|---|
| GrokEdit | 5174 | — |
| GrokPull | 5175 | 8788 |
| GrokPlay | 5176 | — |
| GrokMix | 5177 | 8789 |
| GrokVoice | 5178 | 8790 |
| GrokHarvest | 5179 | 8791 |
| GrokClip | 5180 | 8792 |

## Privacy

All processing is local. Nothing is uploaded. Projects are gitignored.

## Stack

React 19, TypeScript, Vite, FastAPI, faster-whisper, OpenCV, FFmpeg, Lucide, Inter. Local only.
