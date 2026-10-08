# 612 Voice

A free, fully local voice studio for YouTube and podcast narration. Chatterbox cloning, script QC, and multi-speaker stories stay on this machine. Nothing is uploaded except optional YouTube voice imports you choose.

Built as a comparison to [TTS-MAc](https://github.com/Eli-Dolney/TTS): same job (clone a voice, render a channel script, concat for upload), different architecture.

Inspired by [Voicebox](https://github.com/jamiepine/voicebox) (studio UI, takes, stories, effects) and [VibeVoice](https://github.com/microsoft/VibeVoice) (long-form multi-speaker dialogue) — without a subscription, and without Microsoft’s removed TTS inference code.

## Why this vs TTS-MAc, Voicebox, VibeVoice

| | TTS-MAc | Voicebox | VibeVoice | 612 Voice |
|---|---|---|---|---|
| UI | Gradio in the browser | Native Tauri app | Research Gradio / Colab | Vite + React studio |
| Job | Channel scripts → concat | Full voice I/O (TTS + dictation + MCP) | Long-form multi-speaker model | Content-creation TTS studio |
| Engines | Chatterbox English | 7 engines, 23 languages | 1.5B TTS (code pulled) + ASR | Chatterbox clone + macOS Say scratch |
| Multi-speaker | Per-line voice column | Stories timeline | Up to 4 speakers, 90 min in one pass | Speaker 1–4 stories, sequential clone + concat |
| Production | CSV, QC retry, 48 kHz / LUFS, YouTube voice | Effects, takes, queue | Research demos | Same production path, plus takes / effects / live queue |
| Dictation / MCP | No | Yes | ASR models exist | No — TTS output only |
| Cost | Free | Free | Free weights; TTS install disabled upstream | Free |
| Mac | MPS / CPU | MLX / Metal (faster) | Heavy; TTS code removed | MPS / CPU, same Chatterbox you already run |

**Keep TTS-MAc** if the Gradio channel pipeline already ships your episodes.

**Install Voicebox** if you want dictation, MCP agent voice, and a polished native app with many engines.

**Do not expect VibeVoice-TTS as a drop-in** — Microsoft removed the inference code after misuse. Weights on Hugging Face are research-only. 612 Voice copies the *product idea* (labeled speakers, long conversation) using Chatterbox locally.

## Run

Needs **Python 3.12+**, **Node.js 18+**, and enough RAM for Chatterbox (~8 GB recommended). Apple Silicon uses MPS.

```bash
chmod +x run.sh
./run.sh
```

Opens http://localhost:5178. First launch creates `.venv` and installs Chatterbox / PyTorch — that takes several minutes.

Manual:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
npm install
npm run dev
```

## Workflow

1. **Add a voice.** Drop a 5–15 s WAV, or paste a YouTube URL and a start time. That becomes a clone prompt.
2. **Line.** Type one line, hit Generate, listen, keep the take or roll another seed.
3. **Script.** Paste a narration, auto-split into rows, assign a voice, batch render with QC retries, concat to a 48 kHz / −16 LUFS mix.
4. **Story.** Write `Speaker 1:` / `Speaker 2:` dialogue (up to four). Each speaker maps to a cloned voice. Render, then concat with gaps or a short crossfade.

Shortcuts in spirit: Generate from the compose box, Play on the last take, Concat when the line list is green.

## Shows

Each show keeps:

- `show.json` — script, cast, settings
- `lines/` — per-line WAV takes
- `mix.wav` — concat for the editor

Shows and voice samples are gitignored. They never leave this folder.

## Privacy

All synthesis is local. YouTube import is the only optional network call, and only when you paste a URL. No analytics.

## Stack

React 19, TypeScript, Vite, FastAPI, Chatterbox, librosa, Lucide, Inter. Local only.
