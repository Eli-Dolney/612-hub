#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d ".venv" ]]; then
  echo "Creating virtual environment..."
  PYBIN=$(command -v python3.12 || command -v python3.11 || command -v python3)
  "${PYBIN}" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r server/requirements.txt
fi

if [[ ! -d "node_modules" ]]; then
  npm install
fi

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Missing .venv — recreate it with python3 -m venv .venv"
  exit 1
fi

export PYTHONUNBUFFERED=1
URL="http://127.0.0.1:5179"

(
  for _ in $(seq 1 80); do
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
