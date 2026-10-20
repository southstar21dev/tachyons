#!/usr/bin/env bash
# Start (or restart) the visualize server and print its connection JSON.
#   start.sh [--project-dir DIR] [--open] [--host H] [--url-host H] [--idle-timeout-minutes N]
# With --project-dir, the session lives in DIR/.tachyons/visualize/current and is reused
# on restart (same key, same port). Without it, a fresh session goes under $TMPDIR.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="" OPEN=0 PASS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --open) OPEN=1; shift ;;
    *) PASS+=("$1"); shift ;;
  esac
done

if [[ -n "$PROJECT_DIR" ]]; then
  SESSION_DIR="$(cd "$PROJECT_DIR" && pwd)/.tachyons/visualize/current"
else
  SESSION_DIR="${TMPDIR:-/tmp}/tachyons-visualize-$$-$(date +%s)"
fi
STATE_DIR="$SESSION_DIR/state"
mkdir -p "$STATE_DIR" "$SESSION_DIR/content"

# Already running for this session? Hand back the existing info.
if [[ -f "$STATE_DIR/server-info" ]]; then
  PID="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$STATE_DIR/server-info")"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    cat "$STATE_DIR/server-info"; echo
    exit 0
  fi
  rm -f "$STATE_DIR/server-info"
fi

nohup node "$SCRIPT_DIR/server.cjs" --session-dir "$SESSION_DIR" ${PASS[@]+"${PASS[@]}"} \
  >"$STATE_DIR/server.log" 2>&1 &
disown || true

for _ in $(seq 1 50); do
  [[ -f "$STATE_DIR/server-info" ]] && break
  sleep 0.1
done
if [[ ! -f "$STATE_DIR/server-info" ]]; then
  echo "{\"type\":\"error\",\"message\":\"server did not start\",\"log\":\"$STATE_DIR/server.log\"}"
  exit 1
fi

cat "$STATE_DIR/server-info"; echo
if [[ "$OPEN" == 1 ]]; then
  URL="$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$STATE_DIR/server-info")"
  (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true
fi
