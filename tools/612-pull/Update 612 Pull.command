#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
bash tools/docker-control.sh update
RESULT=$?
echo
if [[ $RESULT -ne 0 ]]; then echo "Could not finish. Read the message above."; fi
read -r -p "Press Return to close this window..." _
exit "$RESULT"
