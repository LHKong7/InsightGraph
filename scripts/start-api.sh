#!/usr/bin/env bash
# Start the InsightGraph API server on port 8000 with hot reload.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR"

echo "Starting API server on http://localhost:8000 (hot reload) ..."
pnpm --filter @insightgraph/api run dev
