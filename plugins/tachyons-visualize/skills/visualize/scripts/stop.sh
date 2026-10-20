#!/usr/bin/env bash
# Stop the visualize server for a session dir. Temp sessions are deleted; project sessions are kept.
#   stop.sh SESSION_DIR
set -euo pipefail

SESSION_DIR="${1:?usage: stop.sh SESSION_DIR}"
INFO="$SESSION_DIR/state/server-info"

if [[ -f "$INFO" ]]; then
  PID="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$INFO")"
  [[ -n "$PID" ]] && kill "$PID" 2>/dev/null || true
  for _ in $(seq 1 20); do [[ -f "$INFO" ]] || break; sleep 0.1; done
fi

case "$SESSION_DIR" in
  */.tachyons/visualize/*) echo "stopped; screens kept in $SESSION_DIR/content" ;;
  *tachyons-visualize-*) rm -rf "$SESSION_DIR"; echo "stopped; temp session removed" ;;
  *) echo "stopped" ;;
esac
