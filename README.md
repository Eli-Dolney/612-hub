# GrokHub

Local command center for the Grok creator apps on this Mac. **See what’s live, launch what isn’t, watch jobs in one queue.**

This is the Grok-vs of [LTW Hub](https://github.com/Eli-Dolney/LTW_Hub). Same job (one desk for the studio), different shape: a browser app with a FastAPI launcher instead of a Tauri desktop wrapper. The original Hub is unchanged.

## Why it is different

| | LTW Hub | GrokHub |
|---|---|---|
| Runtime | Tauri + Rust | Vite + FastAPI in the browser you already use |
| Tools | LTW Downloader, Clipper, Audio, EzEdit, Voice | The seven Grok apps on `~/Desktop` |
| Launch | Native process via allowlisted Rust commands | `run.sh` / `npm run dev`, then `open` the UI |
| Queue | Seed / demo jobs | Live `/api/queue` from whichever Grok apps are running |
| Setup | Clone GitHub repos into Documents | Apps are already next to Hub on the Desktop |
| Cost | Free | Free |

Pipeline Hub knows:

**Pull → Harvest → Voice → Mix → Clip → Edit** (Play sits beside them as the listening room).

## Quick start

```bash
cd ~/Desktop/grok-hub
chmod +x run.sh
./run.sh
```

Opens [http://127.0.0.1:5181](http://127.0.0.1:5181). API is `127.0.0.1:8793`.

Launch from the **Studio** tab. **Close** kills that app’s UI and API. The load bar shows Grok CPU and RAM; at 3 live apps (or ~280% Grok CPU) Hub blocks a new Launch until you close one. Two Vite apps at once is the sweet spot.

## Apps

| App | Folder | UI | API |
|---|---|---|---|
| GrokEdit | `~/Desktop/grok` | 5174 | — |
| GrokPull | `~/Desktop/grok-pull` | 5175 | 8788 |
| GrokPlay | `~/Desktop/grok-play` | 5176 | — |
| GrokMix | `~/Desktop/grok-mix` | 5177 | 8789 |
| GrokVoice | `~/Desktop/grok-voice` | 5178 | 8790 |
| GrokHarvest | `~/Desktop/grok-harvest` | 5179 | 8791 |
| GrokClip | `~/Desktop/grok-clip` | 5180 | 8792 |
| GrokHub | `~/Desktop/grok-hub` | 5181 | 8793 |

GrokPlay uses **5176** so it can run next to GrokPull.

## Privacy

Hub only talks to `127.0.0.1`. It does not clone remotes or upload media. Launch logs land in `logs/`.

## Stack

React 19, TypeScript, Vite, FastAPI, Lucide, Inter. Local only.
