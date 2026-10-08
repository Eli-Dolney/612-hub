# Windows test guide

Windows is not runtime-tested yet. The Mac Desktop originals remain unchanged. Start one tool at a time and report the tool name, command and error if something fails.

## Prerequisites

Have Git, Node.js 22.12+ LTS, Python 3.12 (including the `py` launcher), and FFmpeg/ffprobe available on PATH. AI engines may need additional platform-specific packages or a compatible PyTorch build; no dependencies or model weights are bundled.

From PowerShell at the repository root, choose a tool:

```powershell
$tool = "hub"  # hub, play, pull, clip, edit, harvest, mix, voice
Set-Location "tools/612-$tool"
npm ci
# For all tools EXCEPT play and edit:
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
Set-Location ../..
py -3.12 scripts/run.py $tool --check
py -3.12 scripts/run.py $tool
```

Open the browser address from the table below. Ctrl+C stops a directly launched tool. No PowerShell activation policy change is needed; commands use the virtual environment executable directly. Avoid `.command` and `.sh` launchers on Windows; those are Mac/POSIX helpers. `npm run dev` also works from a prepared tool folder.

| Tool | URL | Windows notes |
|---|---|---|
| Hub | http://127.0.0.1:5181 | Sibling tool discovery and Windows process/open commands are included. CPU/RAM telemetry is unavailable on Windows; live status uses HTTP. |
| Play | http://127.0.0.1:5176 | Use Chrome or Edge for folder access. No Python needed. |
| Edit | http://127.0.0.1:5174 | Browser app; no Python needed. |
| Pull | http://127.0.0.1:5175 | FFmpeg/ffprobe and yt-dlp required. YouTube may need the optional PO-token helper, whose native setup script is POSIX; Docker is another documented option. OS folder picker/reveal actions may still be Mac-specific—enter paths manually. |
| Harvest | http://127.0.0.1:5179 | Network access for stock providers; optional API keys in ignored local config. |
| Clip | http://127.0.0.1:5180 | FFmpeg with libass and faster-whisper needed. First transcription downloads a model. VideoToolbox is Mac-only; software encoding is the fallback. Loose custom caption fonts are not bundled; install properly licensed fonts locally if needed. |
| Mix | http://127.0.0.1:5177 | Demucs/PyTorch/audio dependencies need Windows-compatible wheels. CUDA depends on your GPU; MPS is Mac-only. Expect CPU fallback otherwise. |
| Voice | http://127.0.0.1:5178 | Chatterbox/PyTorch and model downloads required for cloning. macOS `say` scratch narration is unavailable on Windows. Synthesis is not validated on Windows. |

## Suggested smoke test

Start Play and Edit first. Then Hub and one API tool. Try a small local file before loading AI models or downloading a playlist. For Pull, verify the downloaded song, 128×128 cover and manifest together. For Clip, test a short software-encoded export and captions before a long job.

No checks have been run on another computer; all reported execution checks were performed on the existing Mac.
