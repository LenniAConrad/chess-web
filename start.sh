#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PNPM_CMD=(npx pnpm@10.5.2)
API_PID=""
WEB_PID=""
STARTUP_TIMEOUT_SECONDS=120

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi

  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

port_in_use() {
  local port="$1"
  ss -ltn "( sport = :$port )" | tail -n +2 | grep -q .
}

wait_for_readiness() {
  local api_ready=0
  local web_ready=0

  while true; do
    if [[ "$api_ready" -eq 0 ]] && curl -fsS -m 1 "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
      api_ready=1
      echo "API ready: http://localhost:3001"
    fi

    if [[ "$web_ready" -eq 0 ]] && curl -fsS -m 1 "http://127.0.0.1:5173" >/dev/null 2>&1; then
      web_ready=1
      echo "Web ready: http://localhost:5173"
    fi

    if [[ "$api_ready" -eq 1 && "$web_ready" -eq 1 ]]; then
      echo "Startup complete in ${SECONDS}s."
      return 0
    fi

    if ! kill -0 "$API_PID" 2>/dev/null; then
      echo "API process exited before becoming ready."
      return 1
    fi

    if ! kill -0 "$WEB_PID" 2>/dev/null; then
      echo "Web process exited before becoming ready."
      return 1
    fi

    if (( SECONDS >= STARTUP_TIMEOUT_SECONDS )); then
      echo "Startup timed out after ${STARTUP_TIMEOUT_SECONDS}s."
      return 1
    fi

    sleep 1
  done
}

if port_in_use 3001; then
  echo "Port 3001 is already in use. Stop the existing API process first."
  exit 1
fi

if port_in_use 5173; then
  echo "Port 5173 is already in use. Stop the existing web process first."
  exit 1
fi

echo "Starting API on http://localhost:3001 ..."
SECONDS=0
"${PNPM_CMD[@]}" --filter @chess-web/api dev &
API_PID=$!

echo "Starting Web on http://localhost:5173 ..."
"${PNPM_CMD[@]}" --filter @chess-web/web dev &
WEB_PID=$!

wait_for_readiness
echo "Both services are running. Press Ctrl+C to stop both."
wait -n "$API_PID" "$WEB_PID"
