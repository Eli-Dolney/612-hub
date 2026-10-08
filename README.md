# 612 Hub studio

Eight local creator tools in one repository. Each lives in `tools/612-<name>` and retains its own frontend, backend, dependencies, and data folder.

| Tool | Purpose | Browser port | API port |
|---|---|---:|---:|
| [Hub](tools/612-hub) | Launch tools, view jobs and media | 5181 | 8793 |
| [Play](tools/612-play) | Local music library and player | 5176 | — |
| [Pull](tools/612-pull) | Download media and portable cover images | 5175 | 8788 |
| [Clip](tools/612-clip) | Transcribe, cut, caption and export clips | 5180 | 8792 |
| [Edit](tools/612-edit) | Thumbnail and photo editor | 5174 | — |
| [Harvest](tools/612-harvest) | Find and curate stock footage | 5179 | 8791 |
| [Mix](tools/612-mix) | Separate stems, analyze and remix audio | 5177 | 8789 |
| [Voice](tools/612-voice) | Local narration and voice studio | 5178 | 8790 |

## Setup and launch on macOS

Use Node.js 22.12+ (or a newer supported LTS), Python 3.12 and FFmpeg on PATH. Prepare only the tools you want to use. From the repository root, for example:

```sh
cd tools/612-hub
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
cd ../..
python3 scripts/run.py hub --check
python3 scripts/run.py hub
```

Open http://127.0.0.1:5181. Repeat preparation for other tools; Play and Edit need only `npm ci`. Hub launches prepared sibling tools. It never installs packages automatically. You can also use `python3 scripts/run.py play`, or run `npm run dev` inside a prepared tool. Each API uses its own `.venv`.

Apple Silicon stays supported by the existing processing engines. This checkout is separate from any Desktop installations; existing media, environments, settings and edits are not moved. Do not run both copies of a tool simultaneously because their ports match.

## Windows

See [WINDOWS.md](WINDOWS.md) for PowerShell commands and per-tool limitations. Windows has not been runtime-tested; the supplied launch paths are designed for both platforms.

## Data and publishing

Source only: no personal media, voice samples, projects, credentials, `.env` files, model weights, environments, dependency folders, caches or build artifacts. Pull guest sharing requires your own `GROKPULL_PASSWORD`; there is no built-in PIN or hosted guest frontend. Optional provider keys remain local.

New Pull downloads can save 128×128 `.cover.png` files and relative-path `.artwork.json` track/playlist manifests for external consumers such as Minecraft. Play reads track cover sidecars; it does not automatically import playlist manifests.

Historical storage keys remain compatible with earlier Grok-branded installations. See [PROVENANCE.md](PROVENANCE.md) for source history and license scope.

## Checks

```sh
python3 -m unittest discover -s tests -v
cd tools/612-play && npm test && npm run build
```

Every frontend also supports `npm run build`; TypeScript can be checked with `npx --no-install tsc --noEmit` after installing that tool's dependencies. Pull artwork checks: from `tools/612-pull`, run `.venv/bin/python -m unittest server.test_artwork -v`.
