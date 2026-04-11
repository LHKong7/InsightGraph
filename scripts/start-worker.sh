#!/usr/bin/env bash
# Start the InsightGraph background worker with hot reload.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR"

echo "Starting background worker (hot reload) ..."
pnpm --filter @insightgraph/worker run dev
