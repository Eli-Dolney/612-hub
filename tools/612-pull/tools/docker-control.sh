#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
ACTION="${1:-start}"
if ! command -v docker >/dev/null 2>&1; then
  echo "Install Docker Desktop on this Mac, open it once, then run Start 612 Pull.command again."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  if [[ "$ACTION" == start && "$(uname)" == Darwin ]]; then
    open -a Docker || { echo "Open Docker Desktop and try again."; exit 1; }
    echo "Waiting for Docker Desktop..."
    for _ in $(seq 1 90); do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  docker info >/dev/null 2>&1 || { echo "Docker is not running. Open Docker Desktop and try again."; exit 1; }
fi
docker compose version >/dev/null
[[ -f .env ]] || { echo "Set GROKPULL_PASSWORD in a local .env before sharing."; exit 1; }
case "$ACTION" in
  start)
    docker compose --profile share up -d --build --wait --wait-timeout 180
    ;;
  stop)
    docker compose --profile share down
    echo "612 Pull stopped. Saved downloads are kept."
    exit 0
    ;;
  update)
    docker compose build --pull --no-cache api
    docker compose up -d --wait --wait-timeout 180 api
    echo "Downloader updated. Existing guest sessions may need to log in again."
    exit 0
    ;;
  link)
    ;;
  *) echo "Usage: $0 {start|stop|update|link}"; exit 1 ;;
esac
ID="$(docker compose --profile share ps -q tunnel)"
[[ -n "$ID" ]] || { echo "Sharing is off. Run Start 612 Pull.command."; exit 1; }
SINCE="$(docker inspect --format '{{.State.StartedAt}}' "$ID")"
PUBLIC=""
for _ in $(seq 1 60); do
  PUBLIC="$(docker compose --profile share logs --no-color --since "$SINCE" tunnel 2>&1 | sed -nE 's/.*(https:\/\/[a-z0-9-]+\.trycloudflare\.com).*/\1/p' | tail -1)"
  [[ -n "$PUBLIC" ]] && break
  sleep 2
done
if [[ -z "$PUBLIC" ]]; then
  echo "No sharing address yet. Check: docker compose --profile share logs --tail 50 tunnel"
  exit 1
fi
FRIEND_URL="$PUBLIC"
mkdir -p .runtime
printf '%s\n' "$FRIEND_URL" > '.runtime/Friend Link.txt'
echo
echo "Send friends this link, then give them your password:"
echo "$FRIEND_URL"
echo
echo "612 Pull keeps running after you close this window."
echo "Keep this Mac powered, awake, and online. Use Stop 612 Pull.command to turn it off."
echo "A tunnel restart changes the link. Double-click Start again to get the current link."
