#!/usr/bin/env bash
# Start all InsightGraph services with hot reload.
# All logs are streamed to this terminal with prefixed labels.
# Services auto-restart when source files change.
# Use Ctrl+C to stop all services.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cleanup() {
  echo ""
  echo "Stopping all services..."
  kill $API_PID $WORKER_PID $WEB_PID 2>/dev/null || true
  wait $API_PID $WORKER_PID $WEB_PID 2>/dev/null || true
  echo "All services stopped."
}
trap cleanup EXIT INT TERM

# Prefix each line of a command's output with a label
run_with_prefix() {
  local prefix="$1"
  shift
  "$@" 2>&1 | sed -u "s/^/[$prefix] /" &
}

# 1. Infrastructure
"$SCRIPT_DIR/start-infra.sh"

# 2. Install deps (tsx watch doesn't need a pre-build)
cd "$ROOT_DIR"
pnpm install

# 3. Start API server (hot reload)
run_with_prefix "api" "$SCRIPT_DIR/start-api.sh"
API_PID=$!

# 4. Start worker (hot reload)
run_with_prefix "worker" "$SCRIPT_DIR/start-worker.sh"
WORKER_PID=$!

# 5. Start web frontend (Next.js already has HMR)
run_with_prefix "web" "$SCRIPT_DIR/start-web.sh"
WEB_PID=$!

sleep 2
echo ""
echo "All services started (hot reload enabled):"
echo "  API:    http://localhost:8000"
echo "  Worker: running"
echo "  Web:    http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services."
wait
