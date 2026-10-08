# 612 Mix

A free, fully local audio splitter and Strudel remix studio. Demucs, librosa, and your files stay on this machine. Nothing is uploaded.

Built as a comparison to [LTW Audio](https://github.com/Eli-Dolney/LTW_Audio_Spiltter): same job (stems, musical analysis, Strudel recreation), different architecture.

## Why this vs LTW Audio

| | LTW Audio | 612 Mix |
|---|---|---|
| UI | Streamlit (reruns, grey screens, file-watcher fights with PyTorch) | Vite + React studio |
| Before Demucs | Upload, then wait on a blocking button | Probe first: waveform, duration, BPM guess |
| Progress | Spinner on a frozen page | SSE job queue with step + percent |
| Layout | One long column of tabs | Library · stage · inspector |
| Remix Lab | Streamlit widgets → download `.js` | Bake into the live player immediately |
| Stem slices | Extra `serve_samples.py` for strudel.cc | Served from the app (`/api/slices/…`) |
| Live Strudel | iframe stuffed into Streamlit | First-class stage player |
| Device | Hidden in logs | MPS / CUDA / CPU badge in the top bar |
| Cost | Free | Free |

Same engine underneath: Demucs 4-stem (MPS on Apple Silicon), librosa pYIN melody/bass, drum onsets, chroma chords, then Strudel building blocks, arrangement, 8 remix presets, and bar-aligned stem slices.

## Run

Needs **Python 3.12+**, **Node.js 18+**, and enough RAM for Demucs (~8 GB recommended).

```bash
chmod +x run.sh
./run.sh
```

Opens http://localhost:5177. First launch creates `.venv` and installs Demucs / PyTorch — that takes a few minutes.

Manual:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
npm install
npm run dev
```

## Workflow

1. **Drop a track.** 612 Mix copies it into `projects/`, draws a waveform, and guesses BPM. Demucs has not started yet.
2. **Split** for vocals / drums / bass / other. Watch the job meter — this is the slow GPU/CPU step.
3. **Analyze** tempo, drums, melody, bass, chords, key. Uses the stems when they exist.
4. **Strudel** writes `building_blocks.js`, `arrangement.js`, eight remixes, and stem-slice patterns.
5. **Remix Lab** (inspector): mute layers, pick sounds, set intensity + seed, **Bake remix**. Play it in the stage or copy into [strudel.cc](https://strudel.cc).

**Run all** queues split → analyze → Strudel as one job.

Shortcuts in spirit: Open audio from the top bar, Play / Stop on the stage, Copy for the current pattern.

## Patterns

Each project keeps:

- `source.*` — the original file
- `stems/` — Demucs WAVs
- `analysis/` — JSON (slim project file, heavy arrays stay here)
- `midi/` — drum / melody / bass MIDI
- `strudel/*.js` — live-coding output
- `slices/` — bar-aligned stem chops

Projects are gitignored. They never leave this folder.

## Privacy

All processing is local. The Strudel player loads `@strudel/web` from a CDN once so the browser can make sound. Offline, copy the `.js` files into strudel.cc or a local REPL.

## Stack

React 19, TypeScript, Vite, FastAPI, Demucs, librosa, pretty_midi, Lucide, Inter. Local only. No analytics.
