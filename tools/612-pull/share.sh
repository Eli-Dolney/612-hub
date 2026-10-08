#!/usr/bin/env bash
# Share the running Docker service, or start a native guest server.
#
#   ./share.sh --tunnel     configured guest clients (native mode needs cloudflared)
#   ./share.sh              same Wi-Fi only
#
# Typing the password on the website cannot start this. The site is just a page.
# This script is what actually turns the engine on.
#
# In native mode Ctrl+C stops it; Docker services stay up. Send friends the
# printed link. A named Cloudflare tunnel (later) would keep one URL forever.
set -euo pipefail
cd "$(dirname "$0")"

TUNNEL=0
[[ "${1:-}" == "--tunnel" ]] && TUNNEL=1

# Docker already owns the engine. Use its tunnel and never start a second API.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_API="$(docker compose ps -q api 2>/dev/null || true)"
  if [[ -n "$DOCKER_API" ]]; then
    if [[ $TUNNEL -eq 1 ]]; then
      docker compose --profile share up -d --wait tunnel
      exec bash tools/docker-control.sh link
    fi
    echo "Docker engine is running at $(docker compose port api 8788)."
    echo "For the friend HTTPS link run: ./share.sh --tunnel"
    exit 0
  fi
fi

if [[ ! -x ".venv/bin/python" ]]; then
  echo "No .venv yet. Run ./run.sh once first."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1 && [[ $TUNNEL -eq 1 ]]; then
  echo "cloudflared is missing. Install it, then re-run:"
  echo "  brew install cloudflared"
  exit 1
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
PORT="${GROKPULL_PORT:-}"
if [[ -z "$PORT" ]]; then
  if curl -sf http://127.0.0.1:8788/api/guest/status 2>/dev/null | .venv/bin/python -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("guest_only") else 1)' 2>/dev/null; then
    PORT=8788
  elif lsof -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; then
    PORT=8789
  else
    PORT=8788
  fi
fi
export GROKPULL_PASSWORD="${GROKPULL_PASSWORD:?Set GROKPULL_PASSWORD before sharing}"
export PYTHONUNBUFFERED=1
export GROKPULL_GUEST_ONLY=1

if [[ -x "tools/ensure-pot.sh" ]]; then
  bash tools/ensure-pot.sh || echo "YouTube guest pulls may 403 until the PO token helper is running."
fi

API_PID=""
TUNNEL_PID=""
LOG=""
trap '[[ -n "$API_PID" ]] && kill $API_PID 2>/dev/null || true; [[ -n "$TUNNEL_PID" ]] && kill $TUNNEL_PID 2>/dev/null || true; [[ -n "$LOG" ]] && rm -f "$LOG"' EXIT

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if ! curl -sf "http://127.0.0.1:$PORT/api/guest/status" >/dev/null 2>&1; then
    echo "Port $PORT is already in use, and it is not the guest API."
    echo "Stop that process, or pick another port:"
    echo "  GROKPULL_PORT=8790 ./share.sh --tunnel"
    exit 1
  fi
  if [[ $TUNNEL -eq 1 ]] && ! curl -sf "http://127.0.0.1:$PORT/api/guest/status" | .venv/bin/python -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("guest_only") else 1)'; then
    echo "That port runs the private studio. Pick a free port for sharing:"
    echo "  GROKPULL_PORT=8790 ./share.sh --tunnel"
    exit 1
  fi
  echo "Engine already running on port $PORT — starting a tunnel only."
else
  .venv/bin/python -m uvicorn server.app:app --host 0.0.0.0 --port "$PORT" &
  API_PID=$!
fi

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$PORT/api/guest/status" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done

echo
echo "Engine is up on this computer. Leave this window open."
echo "Same Wi-Fi:  http://$LAN_IP:$PORT"

if [[ $TUNNEL -eq 1 ]]; then
  LOG="$(mktemp -t grokpull-tunnel)"
  cloudflared tunnel --url "http://127.0.0.1:$PORT" >"$LOG" 2>&1 &
  TUNNEL_PID=$!
  PUBLIC=""
  for _ in $(seq 1 40); do
    PUBLIC="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
    if [[ -n "$PUBLIC" ]]; then
      break
    fi
    sleep 0.4
  done
  echo
  if [[ -n "$PUBLIC" ]]; then
    echo "Send this to friends (password is the one they already know):"
    echo
    echo "  $PUBLIC"
    echo
    echo "After they open it once, the phone remembers the server until you restart this."
  else
    echo "Tunnel started but the public URL has not appeared yet. Watch this log:"
    echo "  $LOG"
  fi
else
  echo
  echo "Phones off your Wi-Fi need HTTPS. Re-run:"
  echo "  ./share.sh --tunnel"
fi

echo
echo "Leave this window open. Ctrl+C stops everything."
if [[ -n "$API_PID" ]]; then
  wait $API_PID
elif [[ -n "$TUNNEL_PID" ]]; then
  wait $TUNNEL_PID
else
  wait
fi
