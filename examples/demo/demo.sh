#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -z "${GEMINI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Error: Set GEMINI_API_KEY or ANTHROPIC_API_KEY"
  exit 1
fi

# Start mock service in background
echo "[demo] Starting mock target API on port ${MOCK_PORT:-4444}..."
MOCK_PID=""
cleanup() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

node --import tsx/esm src/mock-service.ts &
MOCK_PID=$!

for i in $(seq 1 10); do
  if curl -s "http://localhost:${MOCK_PORT:-4444}/health" > /dev/null 2>&1; then
    break
  fi
  sleep 0.3
done

echo "[demo] Mock service ready."
echo ""

node --import tsx/esm src/client.ts

echo ""
echo "[demo] Done."
