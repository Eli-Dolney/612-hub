#!/usr/bin/env bash
# YouTube now 403s stream URLs unless yt-dlp can mint a PO token.
# The Python plugin is already installed; this starts the Node helper on :4416.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if curl -sf --max-time 2 http://127.0.0.1:4416/ping >/dev/null 2>&1; then
  echo "PO token helper already running on :4416"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for YouTube downloads (brew install node)."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to fetch the PO token helper."
  exit 1
fi

POT_DIR="$ROOT/tools/bgutil-ytdlp-pot-provider"
if [[ ! -d "$POT_DIR/.git" ]]; then
  echo "Fetching PO token helper (bgutil 1.3.1)…"
  rm -rf "$POT_DIR"
  git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$POT_DIR"
fi

if [[ ! -f "$POT_DIR/server/build/main.js" ]]; then
  echo "Building PO token helper…"
  (cd "$POT_DIR/server" && npm ci && npx tsc)
fi

echo "Starting PO token helper on :4416…"
nohup node "$POT_DIR/server/build/main.js" >/tmp/grokpull-pot.log 2>&1 &
for _ in $(seq 1 40); do
  if curl -sf --max-time 2 http://127.0.0.1:4416/ping >/dev/null 2>&1; then
    echo "PO token helper is ready."
    exit 0
  fi
  sleep 0.25
done

echo "PO token helper did not start. Last log:"
tail -40 /tmp/grokpull-pot.log || true
exit 1
