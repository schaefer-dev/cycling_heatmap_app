#!/usr/bin/env bash
# Starts API + web UI (dev mode) and stops both on Ctrl+C. Works on macOS and Linux (Raspberry Pi).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi

npm run dev &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT INT TERM

echo "Waiting for the app..."
for _ in $(seq 1 60); do
  if curl -sf http://localhost:3001/api/health >/dev/null && curl -sf http://localhost:5173 >/dev/null; then
    echo "Ready: http://localhost:5173"
    # Open a browser when there is a desktop (skipped on a headless Pi).
    if command -v open >/dev/null; then open http://localhost:5173
    elif [ -n "${DISPLAY:-}" ] && command -v xdg-open >/dev/null; then xdg-open http://localhost:5173
    fi
    break
  fi
  sleep 1
done

wait "$DEV_PID"
