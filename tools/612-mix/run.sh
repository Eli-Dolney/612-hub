#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d ".venv" ]]; then
  echo "Creating Python 3.12 virtual environment..."
  python3.12 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r server/requirements.txt
fi

if [[ ! -d "node_modules" ]]; then
  npm install
fi

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Missing .venv — recreate it with python3.12 -m venv .venv"
  exit 1
fi

export PYTHONUNBUFFERED=1
URL="http://127.0.0.1:5177"

(
  for _ in $(seq 1 60); do
    if curl -sf "$URL" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then
        open "$URL"
      fi
      break
    fi
    sleep 0.4
  done
) &

npm run dev
